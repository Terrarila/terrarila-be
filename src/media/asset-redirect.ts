import type { Request, Response } from 'express';

// Keep existing /assets/... catalog URLs, without streaming large files through a Function.
export function assetRedirect(origin: string) {
  return (req: Request, res: Response) => {
    let segments: string[];
    try {
      segments = decodeURIComponent(req.path).split('/').filter(Boolean);
    } catch {
      res.status(400).end();
      return;
    }
    if (
      !segments.length ||
      segments.some(
        (part) =>
          part.startsWith('.') ||
          part.includes('\\') ||
          [...part].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127),
      )
    ) {
      res.status(404).end();
      return;
    }
    const path = segments.map(encodeURIComponent).join('/');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.redirect(307, `${origin}/assets/${path}`);
  };
}
