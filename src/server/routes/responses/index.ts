import { Router } from 'express';
import { Logger } from '../../../utils/logger';
import { ResponsesController } from './responses-controller';

function createRouter(logger: Logger): Router {
    const router = Router();
    const controller = new ResponsesController(logger);

    router.post('/', (req, res) => controller.handleResponse(req, res));

    return router;
}

export default createRouter;
