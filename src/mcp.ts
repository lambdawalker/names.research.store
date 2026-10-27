import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createMcpProxy } from './mcp-proxy.js';

const handle=await serveStdio(()=>createMcpProxy(process.env.STORE_API_URL??'http://127.0.0.1:4318',process.env.STORE_API_TOKEN??''));
process.once('SIGINT',()=>void handle.close());
process.once('SIGTERM',()=>void handle.close());
