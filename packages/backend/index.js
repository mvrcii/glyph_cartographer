import dotenv from 'dotenv';
import app from './src/app.js';
import { PORT } from './src/config/constants.js';
import spdy from 'spdy';
import fs from 'node:fs';
import path from 'node:path';

dotenv.config();

let server;

try {
  const options = {
    key: fs.readFileSync(path.resolve('./localhost-privkey.pem')),
    cert: fs.readFileSync(path.resolve('./localhost-cert.pem')),
  };
  server = spdy.createServer(options, app);

} catch (error) {
  console.error('\n❌ Error: Could not read SSL certificate files.');
  console.error('   Please run "pnpm install" to generate them automatically.\n');
  process.exit(1);
}

server.listen(PORT, () => {
    console.log(`\n🚀 Backend Server Running with HTTP/2 (via spdy)`);
    console.log(`   URL: https://localhost:${PORT}`);
    console.log(`   Scanning tiles in ${process.env.TILE_DATA_PATH || '<default>'}`);
});


// Graceful shutdown logic.
['SIGTERM', 'SIGINT'].forEach((sig) =>
    process.on(sig, () => {
        console.log(`\n${sig} received. Shutting down gracefully…`);
        server.close(() => process.exit(0));
    }),
);