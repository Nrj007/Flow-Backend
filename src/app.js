import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import authRoutes from './modules/auth/auth.routes.js';
import shopRoutes from './modules/shops/shop.router.js';
import userRoutes from './modules/users/user.router.js';
import { inventoryRouter, publicProductsRouter } from './modules/inventory/inventory.routes.js';
import financeRoutes from './modules/finance/finance.routes.js';
import { studentRouter, shopRouter } from './modules/orders/order.routes.js';

const app = express();

app.use(
  cors({
    origin: env.cors.frontendUrl,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

app.get('/api/health', (_req, res) => {
  res.json({ success: true, message: 'Flow API is running' });
});

app.use('/api/auth', authRoutes);
app.use('/api/shops', shopRoutes);
app.use('/api/users', userRoutes);
app.use('/api/shops/:shopId/products', inventoryRouter);
app.use('/api/shops/:shopId/catalog', publicProductsRouter);
app.use('/api/shops/:shopId/finance', financeRoutes);
app.use('/api/shops/:shopId/orders', shopRouter);
app.use('/api/orders', studentRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
