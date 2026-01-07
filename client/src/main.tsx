import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import {} from 'react-router-dom'
import { BrowserRouter } from 'react-router-dom'
// BrowserRouter Uses the HTML5 history API to keep your UI in sync with the URL.

createRoot(document.getElementById('root')!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
)
