export const getBackendPort = () => {
  if (typeof window === 'undefined') return '5000';
  const params = new URLSearchParams(window.location.search || '');
  return params.get('backendPort') || '5000';
};

export const getBackendBaseUrl = () => `http://127.0.0.1:${getBackendPort()}`;
