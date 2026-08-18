import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate.js';
import { validate } from '../../middleware/validate.js';
import {
  loginHandler,
  loginSchema,
  logoutHandler,
  meHandler,
  refreshHandler,
  registerSchema,
  registerStudentHandler,
  sendOtpHandler,
  verifyOtpHandler,
} from './auth.controller.js';

const router = Router();

router.post('/login', validate(loginSchema), loginHandler);
router.post('/otp/send', sendOtpHandler);
router.post('/otp/verify', verifyOtpHandler);
router.post('/refresh', refreshHandler);
router.post('/logout', logoutHandler);
router.post('/register', validate(registerSchema), registerStudentHandler);
router.get('/me', authenticate, meHandler);

export default router;

