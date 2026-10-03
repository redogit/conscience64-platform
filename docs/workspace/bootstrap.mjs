import {initializeRenderer} from './renderer.mjs';
const renderer=await initializeRenderer(document.getElementById('scene'));
const {mount}=await import('./app.mjs');
await mount(renderer);
