import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('./views/HomeView.vue'),
    },
    {
      path: '/playground',
      name: 'playground',
      component: () => import('./views/PlaygroundView.vue'),
    },
    {
      path: '/examples/line',
      name: 'example-line',
      component: () => import('./views/examples/LineExample.vue'),
    },
    {
      path: '/examples/bar',
      name: 'example-bar',
      component: () => import('./views/examples/BarExample.vue'),
    },
    {
      path: '/examples/pie',
      name: 'example-pie',
      component: () => import('./views/examples/PieExample.vue'),
    },
    {
      path: '/examples/trading',
      name: 'example-trading',
      component: () => import('./views/examples/TradingExample.vue'),
    },
    {
      path: '/examples/candle',
      name: 'example-candle',
      redirect: '/examples/trading',
    },
    {
      path: '/examples/scatter',
      name: 'example-scatter',
      component: () => import('./views/examples/ScatterExample.vue'),
    },
    {
      path: '/examples/histogram',
      name: 'example-histogram',
      component: () => import('./views/examples/HistogramExample.vue'),
    },
    {
      path: '/examples/streaming',
      name: 'example-streaming',
      component: () => import('./views/examples/StreamingExample.vue'),
    },
  ],
  scrollBehavior() {
    return { top: 0 }
  },
})
