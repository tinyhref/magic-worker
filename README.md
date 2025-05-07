# MagicWorker

##  Installation

```bash
npm install @microui-kit/magic-worker
or
yarn add @microui-kit/magic-worker
```

## Use It

```js
import { MagicWorker } from '@microui-kit/magic-worker';

const worker = MagicWorker.init({
  methods: {
    counter: 0,
    inc() {
      return ++this.counter;
    },
    add(a: number, b: number) {
      return a + b;
    },
    multiply: (a: number, b: number) => {
      return a * b;
    }
  }
});

(async () => {
  console.log('1 + 1 = ', await worker.add(1, 1));
  console.log('2 * 2 = ', await worker.multiply(2, 2));
})();
```
