import { Router } from "express";

export function createAsyncRouter() {
  const router = Router();
  for (const method of ["get", "post", "put", "patch", "delete"] as const) {
    const register = (router as any)[method].bind(router);
    (router as any)[method] = (path: string, ...handlers: any[]) => register(path, ...handlers.map((handler) => {
      if (typeof handler !== "function") return handler;
      return (req: any, res: any, next: (error?: unknown) => void) => {
        try {
          const result = handler(req, res, next);
          if (result && typeof result.then === "function") result.catch(next);
          return result;
        } catch (error) {
          return next(error);
        }
      };
    }));
  }
  return router;
}
