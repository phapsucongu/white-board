import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

const defaultCorsOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];

function getCorsOrigins(): string[] {
  const configuredOrigin = process.env.CORS_ORIGIN;

  if (!configuredOrigin) {
    return defaultCorsOrigins;
  }

  return configuredOrigin
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: getCorsOrigins()
  });
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true
    })
  );

  const port = Number(process.env.BACKEND_PORT ?? 3000);

  await app.listen(port);
}

void bootstrap();
