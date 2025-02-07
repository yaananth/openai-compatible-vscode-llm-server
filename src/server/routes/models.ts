import { Router } from 'express';
import { Logger } from '../../utils/logger';

function createRouter(logger: Logger): Router {
    const router = Router();

    router.get('/', (req, res) => {
    logger.log('Models endpoint accessed');
    res.json({
        object: 'list',
        data: [
            {
                id: 'claude-3.5-sonnet',
                object: 'model',
                created: 1677610602,
                owned_by: 'openai',
            },
            {
                id: 'gpt-4o',
                object: 'model',
                created: 1687882412,
                owned_by: 'openai',
            },
            {
                id: 'gpt-4o-mini',
                object: 'model',
                created: 1687882412,
                owned_by: 'openai',
            },
            {
                id: 'o3-mini',
                object: 'model',
                created: 1687882412,
                owned_by: 'openai',
            },
            {
                id: 'o1',
                object: 'model',
                created: 1687882412,
                owned_by: 'openai',
            }
        ]
    });
    });

    return router;
}

export default createRouter;
