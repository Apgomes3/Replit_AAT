import axios from 'axios';
import toast from 'react-hot-toast';
import { supportError } from './supportError';

const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('edp_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('edp_token');
      window.location.href = '/login';
    } else if (['post', 'put', 'patch', 'delete'].includes(err.config?.method?.toLowerCase())) {
      // Never retry a mutation automatically: the server may have committed it
      // even when the browser timed out before receiving a response.
      toast.error(supportError(err, err.response
        ? 'Changes could not be confirmed. Review the record before retrying.'
        : 'Connection lost. Check whether your changes were saved before retrying.'));
    }
    return Promise.reject(err);
  }
);

export default api;
