import { Router } from 'express';
import { Logger } from '../../../utils/logger';
import { ChatController } from './chat-controller';

function createRouter(logger: Logger): Router {
    const router = Router();
    const chatController = new ChatController(logger);

    router.post('/completions', (req, res) => chatController.handleChatCompletion(req, res));

    return router;
}

export default createRouter;
