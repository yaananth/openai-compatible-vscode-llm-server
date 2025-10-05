import express from 'express';
import { Server as HttpServer } from 'http';
import * as vscode from 'vscode';
import bodyParser from 'body-parser';
import { Logger } from '../utils/logger';
import { StatusBarManager } from '../statusBar/statusBar';
import modelsRouter from './routes/models';
import chatRouter from './routes/chat';
import responsesRouter from './routes/responses';

export class ServerManager {
    private static instance: ServerManager;
    private server: HttpServer | undefined;
    private app: express.Application;
    private logger: Logger;
    private statusBar: StatusBarManager;

    private constructor(logger: Logger, statusBar: StatusBarManager) {
        this.app = express();
        this.logger = logger;
        this.statusBar = statusBar;
        this.setupMiddleware();
        this.setupRoutes();
    }

    public static initialize(logger: Logger, statusBar: StatusBarManager): ServerManager {
        if (!ServerManager.instance) {
            ServerManager.instance = new ServerManager(logger, statusBar);
        }
        return ServerManager.instance;
    }

    public static getInstance(): ServerManager {
        if (!ServerManager.instance) {
            throw new Error('ServerManager not initialized');
        }
        return ServerManager.instance;
    }

    private setupMiddleware(): void {
        this.app.use(bodyParser.json({ limit: '100mb' }));
        this.app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));
        
        // Custom middleware for request logging and CORS
        this.app.use('/v1', (req: express.Request, res: express.Response, next: express.NextFunction) => {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
            
            if (req.method === 'OPTIONS') {
                res.status(200).end();
                return;
            }

            this.logger.log(`Incoming ${req.method} request to ${req.path}`);
            next();
        });

        // Global error handling middleware
        this.app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
            this.logger.log(`Error caught in middleware: ${err.message}`);
            if (!res.headersSent) {
                res.status(500).json({
                    error: {
                        message: err.message || 'Internal server error',
                        type: 'server_error'
                    }
                });
            }
        });
    }

    private setupRoutes(): void {
        this.app.use('/v1/models', modelsRouter(this.logger));
        this.app.use('/v1/chat', chatRouter(this.logger));
        this.app.use('/v1/responses', responsesRouter(this.logger));
        this.app.use('/v1/messages', responsesRouter(this.logger));
    }

    public async start(): Promise<boolean> {
        await this.ensureServerStopped(false);

        const config = vscode.workspace.getConfiguration('openaiCompatibleServer');
        const port = config.get('port', 3775);

        try {
            await this.listen(port);
            this.logger.log(`Server started on port ${port}`);
            vscode.window.showInformationMessage(`OpenAI compatible server running on http://localhost:${port}`);
            this.statusBar.update(true);
            return true;
        } catch (error) {
            const err = error as NodeJS.ErrnoException;
            if (err.code === 'EADDRINUSE') {
                this.logger.log(`Port ${port} in use. Attempting automatic recovery.`);
                const recovered = await this.recoverPortConflict(port);
                if (recovered) {
                    return await this.start();
                }
            }

            this.logger.log(`Server failed to start: ${err.message}`);
            this.cleanupServerOnFailure(err);
            return false;
        }
    }

    public async stop(): Promise<boolean> {
        if (!this.server) {
            this.logger.log('Server stop attempted while not running');
            vscode.window.showInformationMessage('Server is not running');
            return false;
        }

        await this.ensureServerStopped(true);
        this.logger.log('Server stopped');
        vscode.window.showInformationMessage('OpenAI compatible server stopped');
        return true;
    }

    public isRunning(): boolean {
        return this.server !== undefined;
    }

    public getServerPort(): number {
        const config = vscode.workspace.getConfiguration('openaiCompatibleServer');
        return config.get('port', 3775);
    }
    private cleanupServerOnFailure(error: Error | NodeJS.ErrnoException): void {
        void this.ensureServerStopped(false);
        const message = error.message || 'Server failed to start';
        vscode.window.showErrorMessage(`OpenAI compatible server error: ${message}`);
    }

    private async recoverPortConflict(port: number): Promise<boolean> {
        try {
            return await this.forceStopExistingServer(port);
        } catch (error) {
            const err = error as Error;
            this.logger.log(`Failed to recover from port conflict: ${err.message}`);
            vscode.window.showErrorMessage(
                `OpenAI compatible server could not start because port ${port} is in use by another process. ` +
                'Close the other process or update the configured port, then try again.'
            );
            return false;
        }
    }

    private async ensureServerStopped(updateStatus: boolean): Promise<void> {
        if (!this.server) {
            if (updateStatus) {
                this.statusBar.update(false);
            }
            return;
        }

        await new Promise<void>((resolve) => {
            this.server?.close(() => resolve());
        });

        this.server = undefined;

        if (updateStatus) {
            this.statusBar.update(false);
        }
    }

    private async listen(port: number): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            try {
                const server = this.app.listen(port, () => {
                    resolve();
                });

                this.server = server;

                server.once('error', reject);

                server.on('error', (error: NodeJS.ErrnoException) => {
                    if (error.code === 'EADDRINUSE') {
                        // handled separately
                        return;
                    }
                    this.logger.log(`Server runtime error: ${error.message}`);
                    this.cleanupServerOnFailure(error);
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    private async forceStopExistingServer(port: number): Promise<boolean> {
        this.logger.log(`Attempting to free port ${port} by stopping lingering server instance.`);

        await this.ensureServerStopped(false);

        try {
            await vscode.commands.executeCommand('openai-server.stopServer');
        } catch {
            // ignore errors from command execution
        }

        await new Promise<void>((resolve) => setTimeout(resolve, 200));

        const net = await import('net');
        await new Promise<void>((resolve, reject) => {
            const tester = net.createServer()
                .once('error', (err: NodeJS.ErrnoException) => {
                    tester.close();
                    if (err.code === 'EADDRINUSE') {
                        this.logger.log(`Port ${port} is still in use.`);
                    }
                    reject(err);
                })
                .once('listening', () => {
                    tester.close();
                    resolve();
                })
                .listen(port, '127.0.0.1');
        });

        return true;
    }

}
