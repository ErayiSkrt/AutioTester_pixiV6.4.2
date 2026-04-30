import './styles.css';
import { AudioTester } from './AudioTester';
import { buildUI } from './ui';

const tester = new AudioTester();

const root = document.getElementById('app');
if (root) {
  buildUI(root, tester);
}

(window as any).audioTester = tester;
