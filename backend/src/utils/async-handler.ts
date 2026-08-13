import type { NextFunction, Request, Response, RequestHandler } from 'express'

type AsyncRouteHandler = (req: Request, res: Response, next: NextFunction) => Promise<void | unknown>

// Обгортає async Express handler і передає rejection у next().
export function asyncHandler(handler: AsyncRouteHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next)
  }
}
