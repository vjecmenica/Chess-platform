import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AccountPage } from './MyGames';
import './style.css';

if (/^\/my-games\/?$/.test(window.location.pathname)) window.location.replace('/account');

createRoot(document.getElementById('root')!).render(<StrictMode>
  {/^\/(?:account|my-games)\/?$/.test(window.location.pathname) ? <AccountPage /> : <App />}
</StrictMode>);
