import { base, react } from '@eeasy-logistics/config-eslint';
import nextPlugin from '@next/eslint-plugin-next';
import { defineConfig } from 'eslint/config';

export default defineConfig(base, react, nextPlugin.configs['core-web-vitals']);
