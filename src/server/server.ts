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

    public start(): boolean {
        if (this.server) {
            this.logger.log('Server start requested while already running; restarting existing instance.');
            this.stop();
        }

        const config = vscode.workspace.getConfiguration('openaiCompatibleServer');
        const port = config.get('port', 3775);

        const attemptStart = () => {
            try {
                this.server = this.app.listen(port, () => {
                    this.logger.log(`Server started on port ${port}`);
                    vscode.window.showInformationMessage(`OpenAI compatible server running on http://localhost:${port}`);
                    this.statusBar.update(true);
                });

                this.server.on('error', (error: NodeJS.ErrnoException) => {
                    if (error.code === 'EADDRINUSE') {
                        this.logger.log(`Port ${port} in use. Attempting automatic recovery.`);
                        this.recoverPortConflict(port);
                        return;
                    }
                    this.logger.log(`Server error: ${error.message}`);
                    this.cleanupServerOnFailure(error);
                });
            } catch (error) {
                const err = error as NodeJS.ErrnoException;
                this.logger.log(`Server failed to start: ${err.message}`);
                if (err.code === 'EADDRINUSE') {
                    this.logger.log(`Port ${port} in use during initial start. Attempting automatic recovery.`);
                    this.recoverPortConflict(port);
                } else {
                    this.cleanupServerOnFailure(err);
                }
            }
        };

        attemptStart();
        return this.server !== undefined;
    }

    public stop(): boolean {
        if (!this.server) {
            this.logger.log('Server stop attempted while not running');
            vscode.window.showInformationMessage('Server is not running');
            return false;
        }

        this.server.close();
        this.server = undefined;
        this.logger.log('Server stopped');
        vscode.window.showInformationMessage('OpenAI compatible server stopped');
        this.statusBar.update(false);
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
        if (this.server) {
            try {
                this.server.close();
            } catch {
                // ignore close errors
            } finally {
                this.server = undefined;
            }
        }

        this.statusBar.update(false);
        const message = error.message || 'Server failed to start';
        vscode.window.showErrorMessage(`OpenAI compatible server error: ${message}`);
    }

    private recoverPortConflict(port: number): void {
        this.forceStopExistingServer(port)
            .then(() => {
                this.logger.log(`Retrying server start on port ${port} after recovery.`);
                this.start();
            })
            .catch(error => {
                const err = error as Error;
                this.logger.log(`Failed to recover from port conflict: ${err.message}`);
                this.cleanupServerOnFailure(err);
            });
    }

    private async forceStopExistingServer(port: number): Promise<void> {
        this.logger.log(`Attempting to free port ${port} by stopping lingering server instance.`);

        if (this.server) {
            try {
                this.server.close();
            } catch {
                // ignore
            } finally {
                this.server = undefined;
            }
        }

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
                    if (err.code === 'EADDRINUSE') {
                        this.logger.log(`Port ${port} still in use after stop. Please ensure no other process is bound to this port.`);
                    }
                    tester.close();
                    reject(err);
                })
                .once('listening', () => {
                    tester.close();
                    resolve();
                })
                .listen(port, '127.0.0.1');
        });
    }

}
