#!/usr/bin/env node
// Exit 0 when this Node.js can run EXDA's frontend tools, 1 when it is too old.
// Vite 7 requires Node.js ^20.19.0 or >=22.12.0 (see node_modules/vite/package.json "engines").
// On failure the installed version is printed so launchers can show it.
const [major, minor] = process.versions.node.split('.').map(Number);
const supported = major > 22 || (major === 22 && minor >= 12) || (major === 20 && minor >= 19);
if (!supported) console.log(process.versions.node);
process.exit(supported ? 0 : 1);
