import type { RequestHandler } from 'express';

// Express 4 does not forward rejected promises to its error middleware.
export const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => {
  try { Promise.resolve(handler(req, res, next)).catch(next); }
  catch (error) { next(error); }
};
