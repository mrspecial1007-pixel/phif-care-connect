import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { bindItemsAnalyticsSessionCache } from "./lib/items-analytics-cache.helpers";

export const getRouter = () => {
  const queryClient = new QueryClient();
  bindItemsAnalyticsSessionCache(queryClient);

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
