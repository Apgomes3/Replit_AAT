"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notFound = exports.errorHandler = void 0;
const errorHandler = (err, req, res, next) => {
    console.error(err);
    const status = err.status || 500;
    res.status(status).json({
        error: {
            code: err.code || 'SERVER_ERROR',
            message: err.message || 'An unexpected error occurred',
        }
    });
};
exports.errorHandler = errorHandler;
const notFound = (req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route ${req.path} not found` } });
};
exports.notFound = notFound;
