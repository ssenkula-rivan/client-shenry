// Vercel Serverless Function Entry Point
export default async function handler(req, res) {
  // Import and run the main server
  const { default: app } = await import('../server.js');
  return app(req, res);
}