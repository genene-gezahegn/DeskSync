
import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Req,
  UseGuards,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';

import * as jwt from 'jsonwebtoken';
import { ApiService } from './api.service';

// ==========================================
// AUTHENTICATION GUARD
// ==========================================

class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const authorization = req.headers.authorization || '';

    const match = authorization.match(/^Bearer\s+(.+)$/i);
    const token = match?.[1]?.trim();

    if (!token) {
      throw new UnauthorizedException('Please sign in');
    }

       try {
      const secret = process.env.JWT_SECRET;

      if (!secret || secret.length < 32) {
        throw new UnauthorizedException(
          'Authentication is unavailable',
        );
      }

      const decoded: any = jwt.verify(token, secret);

      if (!decoded.sub || !decoded.role) {
        throw new UnauthorizedException('Invalid session');
      }

      req.user = decoded;
      return true;
    } catch {
      throw new UnauthorizedException('Please sign in');
    }
  }
}

// ==========================================
// ADMINISTRATOR GUARD
// ==========================================

class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();

    const role = String(req.user?.role || '').toUpperCase();

    if (role !== 'ADMIN') {
      throw new ForbiddenException(
        'Administrator access required',
      );
    }

    return true;
  }
}

// ==========================================
// API CONTROLLER
// ==========================================

@Controller('api')
export class ApiController {
  constructor(private readonly s: ApiService) {}

  // ========================================
  // HEALTH CHECK
  // ========================================

  @Get('health')
  health() {
    return {
      status: 'ok',
      app: 'DeskSync API',
      timestamp: new Date().toISOString(),
    };
  }

  // ========================================
  // AUTHENTICATION
  // ========================================

  @Post('auth/login')
  login(@Body() body: any) {
    return this.s.login(
      body?.email,
      body?.password,
    );
  }

  @Post('auth/register')
  register(@Body() body: any) {
    return this.s.register(body || {});
  }

  @UseGuards(AuthGuard)
  @Get('auth/me')
  me(@Req() req: any) {
    return {
      id: req.user.sub,
      email: req.user.email,
      name: req.user.name,
      role: String(req.user.role).toUpperCase(),
    };
  }

  // ========================================
  // DESKS
  // ========================================

  @UseGuards(AuthGuard)
  @Get('desks')
  desks() {
    return this.s.desks();
  }

  // ========================================
  // ZONES
  // ========================================

  @UseGuards(AuthGuard)
  @Get('zones')
  zones() {
    return this.s.zones();
  }

  // ========================================
  // BOOKINGS
  // ========================================

  @UseGuards(AuthGuard)
  @Get('bookings')
  bookings(@Req() req: any) {
    const isAdmin =
      String(req.user.role).toUpperCase() === 'ADMIN';

    return this.s.bookings(req.user, isAdmin);
  }

  @UseGuards(AuthGuard)
  @Post('bookings')
  book(
    @Req() req: any,
    @Body() body: any,
  ) {
    return this.s.createBooking(req.user, body || {});
  }

  @UseGuards(AuthGuard)
  @Post('bookings/:id/cancel')
  cancel(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.s.cancelBooking(
      req.user,
      id,
      body?.reason,
    );
  }

  // ========================================
  // DESK CHANGE REQUESTS
  // ========================================

  @UseGuards(AuthGuard)
  @Get('desk-changes')
  changes(@Req() req: any) {
    const isAdmin =
      String(req.user.role).toUpperCase() === 'ADMIN';

    return this.s.changes(req.user, isAdmin);
  }

  @UseGuards(AuthGuard)
  @Post('desk-changes')
  requestChange(
    @Req() req: any,
    @Body() body: any,
  ) {
    return this.s.changeRequest(req.user, body || {});
  }

  // ========================================
  // ADMIN REVIEW
  // ========================================

  @UseGuards(AuthGuard, AdminGuard)
  @Post('admin/review/:type/:id')
  review(
    @Req() req: any,
    @Param('type') type: string,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.s.review(
      req.user,
      type,
      id,
      body?.status,
      body?.comment,
    );
  }

  // ========================================
  // ADMIN DASHBOARD STATISTICS
  // ========================================

  @UseGuards(AuthGuard, AdminGuard)
  @Get('admin/stats')
  stats() {
    return this.s.stats();
  }

  // ========================================
  // ADMIN USER MANAGEMENT
  // ========================================

  @UseGuards(AuthGuard, AdminGuard)
  @Get('admin/users')
  users() {
    return this.s.users();
  }

  // ========================================
  // ADMIN AUDIT LOGS
  // ========================================

  @UseGuards(AuthGuard, AdminGuard)
  @Get('admin/audit-logs')
  logs() {
    return this.s.logs();
  }

  // ========================================
  // ADMIN DESK MANAGEMENT
  // ========================================

  @UseGuards(AuthGuard, AdminGuard)
  @Post('admin/desks')
  createDesk(
    @Req() req: any,
    @Body() body: any,
  ) {
    return this.s.createDesk(req.user, body || {});
  }

  @UseGuards(AuthGuard, AdminGuard)
  @Delete('admin/desks/:id')
  deleteDesk(
    @Req() req: any,
    @Param('id') id: string,
  ) {
    return this.s.deleteDesk(req.user, id);
  }
}
