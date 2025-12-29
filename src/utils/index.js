export const createPageUrl = (pageName) => {
  const routes = {
    Employees: '/employees',
    Schedule: '/schedule', 
    Analytics: '/analytics',
    Status: '/status',
    Login: '/login',
  };
  return routes[pageName] || '/';
};