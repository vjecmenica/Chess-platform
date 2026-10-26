import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { MyGames } from './MyGames';
import './style.css';

createRoot(document.getElementById('root')!).render(<StrictMode>
  {/^\/my-games\/?$/.test(window.location.pathname) ? <MyGames /> : <App />}
</StrictMode>);
