import {initializeRenderer} from './renderer.mjs';
try {
 const renderer=await initializeRenderer(document.getElementById('scene'));
 const {mount}=await import('./app.mjs');
 await mount(renderer);
} catch(error) {
 document.getElementById('runtime').textContent='Workspace unavailable';
 document.getElementById('notice').textContent='Could not initialize: '+error.message;
 console.error(error);
}
