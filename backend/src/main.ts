
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './module';
import * as dotenv from 'dotenv';

dotenv.config();

async function bootstrap() {
  try {
    // Validate JWT secret
    const jwtSecret = process.env.JWT_SECRET;

    if (!jwtSecret || jwtSecret.length < 32) {
      throw new Error(
        'JWT_SECRET must be configured and contain at least 32 characters.',
      );
    }

    // Create NestJS application
    const app = await NestFactory.create(AppModule);

    // Configure CORS
    const frontendOrigin =
      process.env.FRONTEND_ORIGIN || 'http://localhost:5173';

    app.enableCors({
      origin: frontendOrigin,
      credentials: true,
    });

    // Configure global validation
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: true,
      }),
    );

    // Configure production port
    const port = Number(process.env.PORT) || 4000;

    await app.listen(port, '0.0.0.0');

    console.log(`DeskSync API running on port ${port}`);
    console.log(`Frontend origin: ${frontendOrigin}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  } catch (error) {
    console.error('Failed to start DeskSync API:', error);
    process.exit(1);
  }
}

bootstrap();
