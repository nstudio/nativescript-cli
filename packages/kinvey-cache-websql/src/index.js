import { register as _register } from 'kinvey-cache';
import * as WebSQL from './websql';

export function register() {
  _register(WebSQL);
}