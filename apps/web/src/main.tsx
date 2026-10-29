import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AccountPage } from './MyGames';
import { RecoveryPage, type RecoveryMode } from './AccountRecovery';
import './style.css';

const recoveryMode = /^\/account\/(recover|verify-email|reset-password)\/?$/.exec(window.location.pathname)?.[1] as RecoveryMode | undefined;
// Fragments never reach HTTP logs. Remove the token from browser history before rendering anything.
const recoveryToken = recoveryMode ? window.location.hash.slice(1) : '';
if (recoveryMode && window.location.hash) window.history.replaceState(null, '', window.location.pathname);

if (/^\/my-games\/?$/.test(window.location.pathname)) window.location.replace('/account');

createRoot(document.getElementById('root')!).render(<StrictMode>
  {recoveryMode ? <RecoveryPage mode={recoveryMode} token={recoveryToken} /> : /^\/(?:account|my-games)\/?$/.test(window.location.pathname) ? <AccountPage /> : <App />}
</StrictMode>);
