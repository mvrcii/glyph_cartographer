import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const keyPath = path.resolve(process.cwd(), 'localhost-privkey.pem');
const certPath = path.resolve(process.cwd(), 'localhost-cert.pem');

// Check if both files already exist.
if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  console.log('Certificates already exist. Skipping generation.');
  process.exit(0);
}

console.log('Generating self-signed certificate for local development...');

const opensslCommand = `openssl req -x509 -newkey rsa:2048 -nodes -sha256 -subj '/CN=localhost' -keyout localhost-privkey.pem -out localhost-cert.pem`;

try {
  execSync(opensslCommand, { stdio: 'inherit' });
  console.log('Successfully generated localhost-privkey.pem and localhost-cert.pem');
} catch (error) {
  console.error('Error generating certificates.');
  console.error('Please ensure OpenSSL is installed and accessible in your system PATH.');
  console.error(error);
  process.exit(1);
}