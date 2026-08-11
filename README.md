# Flow Backend

Express API for the Flow shop management system.

## Setup

```bash
cd backend
cp .env.example .env
# Edit .env with your AWS/DynamoDB and JWT secrets
npm install
```

Create the DynamoDB table — see [dynamodb-setup.md](./dynamodb-setup.md).

## Run

```bash
npm run dev
```

API runs at `http://localhost:5000`. A Super Admin account is seeded on first startup using `SUPER_ADMIN_*` env vars.

## API Overview

| Method | Endpoint | Roles |
|--------|----------|-------|
| POST | `/api/auth/login` | Public |
| POST | `/api/auth/refresh` | Public (cookie) |
| POST | `/api/auth/logout` | Public |
| POST | `/api/auth/register` | Public (student) |
| GET | `/api/auth/me` | Authenticated |
| GET | `/api/shops/public` | Public |
| POST | `/api/shops` | Super Admin |
| GET | `/api/shops` | Super Admin |
| GET | `/api/shops/:shopId` | Super Admin, Manager, Staff |
| POST/GET | `/api/users/staff` | Shop Manager |
| CRUD | `/api/shops/:shopId/products` | Super Admin, Manager, Staff |
| GET | `/api/shops/:shopId/catalog` | Public |
| GET/POST | `/api/shops/:shopId/finance` | Super Admin, Manager (**Staff blocked**) |
| POST/GET | `/api/orders` | Student |
| GET/PATCH | `/api/shops/:shopId/orders` | Super Admin, Manager, Staff |
