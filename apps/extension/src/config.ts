// Public backend address only. Provider/database credentials never enter the extension.
export const API_BASE=(import.meta.env?.VITE_US_API_BASE||'http://127.0.0.1:5173').replace(/\/+$/,'');
