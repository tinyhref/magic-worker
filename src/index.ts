enum ACTION_TYPE {
  GLOBAL = 'global'
}

enum WORKER_NAME {
  MAIN = 'main'
}

interface WorkerMessage {
  action: ACTION_TYPE;
  payload: {
    id: string | null;
    method?: string;
    args?: any[];
    result?: any;
    error?: string;
    workerName?: string;
  };
}

interface CallbackPair {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
}

interface MagicWorkerOptions {
  methods: Record<string, any>;
  imports?: string[];
}

interface EventCallback {
  (data?: any): void;
}

interface EventMap {
  [eventName: string]: EventCallback[];
}

class MagicWorkerClass {
  private static sdk: MagicWorkerClass | undefined;
  public worker: Worker | null = null;
  private callbacks: Record<string, CallbackPair> = {};
  private counter: number = 0;
  private events: EventMap = {};

  static instance(): MagicWorkerClass {
    if (!this.sdk) {
      this.sdk = new MagicWorkerClass();
    }

    return this.sdk;
  }

  constructor(options?: MagicWorkerOptions) {
    if (options) {
      this.init(options);
    }
  }

  init(options: MagicWorkerOptions): MagicWorkerClass['worker'] {
    if (!this.worker) {
      this.createWorker(WORKER_NAME.MAIN, options);
    }

    return this.worker
  }

  createWorker(workerName: string, options: MagicWorkerOptions): MagicWorkerClass['worker'] {
    const { methods, imports } = options;

    if (!methods) {
      throw new Error('methods required');
    }

    if (workerName === WORKER_NAME.MAIN) {
      if (this.worker) {
        return this.worker;
      }
    }

    if ((this as any)[workerName]) {
      return (this as any)[workerName]
    }

    let importScripts = '';

    if (imports) {
      importScripts = `${this.importScripts(imports)}\n`;
    }

    const workerCode = `${importScripts}${this.serializeToString(methods)} \n\n self.onmessage = ${this.onMessageWorker.toString().trim()}`;
    const blob = new Blob([workerCode], { type: 'application/javascript' });
    const worker = new Worker(URL.createObjectURL(blob));

    (worker as any).destroy = () => this.destroy(worker, workerName);
    worker?.addEventListener('message', this.onMessage);

    if (workerName === WORKER_NAME.MAIN) {
      this.worker = worker;
      this.expose(workerName, methods);
      return this.worker
    }

    (this as any)[workerName] = worker;
    this.expose(workerName, methods);
    return (this as any)[workerName]
  }

  onMessageWorker = (event: MessageEvent): void => {
    const data = event.data as WorkerMessage;

    const { action, payload } = data;

    const id = payload.id;

    if (action !== ACTION_TYPE.GLOBAL || !id) {
      return;
    }

    const method = payload.method;
    const args = payload.args || [];
    const workerName = payload.workerName;

    if (method) {
      const func = (self as any)[method];

      if (typeof func === 'function') {
        try {
          const result = func(...args);

          self.postMessage({
            action: ACTION_TYPE.GLOBAL,
            payload: {
              id,
              method,
              result,
              workerName
            }
          });
        } catch (err) {
          self.postMessage({
            action: ACTION_TYPE.GLOBAL,
            payload: {
              id,
              method,
              error: '' + err
            }
          });
        }
      }
    } else {
      self.postMessage({
        action: ACTION_TYPE.GLOBAL,
        payload: {
          id,
          method,
          error: 'NO_SUCH_METHOD'
        }
      });
    }
  }

  onMessage = (event: MessageEvent): void => {
    const data = event.data as WorkerMessage;

    const { action, payload } = data;

    const id = payload.id;

    if (action !== ACTION_TYPE.GLOBAL || !id) {
      return;
    }

    const result = payload.result;
    const workerName = payload.workerName;
    const error = payload.error;

    const callback = this.callbacks[id];

    if (!callback) {
      throw Error(`Unknown callback ${id}`);
    }

    const method = payload.method;

    if (method) {
      if (workerName) {
        this.emit(`${workerName}/${method}`, result);
      } else {
        this.emit(method, result);
      }
    }

    const { resolve, reject } = callback;

    delete this.callbacks[id];

    if (error) {
      reject(Error(error));
    } else {
      resolve(result);
    }
  }

  expose(workerName: string, obj: Record<string, any> = {}): void {
    if (workerName === WORKER_NAME.MAIN) {
      if (!this.worker) {
        return;
      }

      for (const method in obj) {
        if (!(method in this.worker)) {
          const value = obj[method];

          if (typeof value === 'function') {
            (this.worker as any)[method] = (...args: any[]): Promise<any> => {
              return new Promise((resolve, reject) => {
                const id = `rpc${++this.counter}`;
                this.callbacks[id] = {
                  resolve,
                  reject
                };

                this.worker!.postMessage({
                  action: ACTION_TYPE.GLOBAL,
                  payload: {
                    id,
                    method,
                    args
                  }
                });
              });
            };
          }
        }
      }

      return;
    }

    if (!(this as any)[workerName]) {
      return;
    }

    for (const method in obj) {
      if (!(method in (this as any)[workerName])) {
        const value = obj[method];

        if (typeof value === 'function') {
          ((this as any)[workerName] as any)[method] = (...args: any[]): Promise<any> => {
            return new Promise((resolve, reject) => {
              const id = `rpc${++this.counter}`;
              this.callbacks[id] = {
                resolve,
                reject
              };

              (this as any)[workerName]!.postMessage({
                action: ACTION_TYPE.GLOBAL,
                payload: {
                  id,
                  method,
                  args,
                  workerName
                }
              });
            });
          };
        }
      }
    }
  }

  serializeToString(obj: Record<string, any> = {}): string {
    return Object.entries(obj)
    .map(([key, value]) => {
      if (typeof value === 'function') {
        const raw = value.toString().trim();

        if (raw.startsWith('function')) {
          return `${key} = ${raw.replace(/^function\s*/, `function `)};`;
        }

        if (raw.includes('=>')) {
          return `${key} = ${raw};`;
        }

        const argsMatch = raw.match(/\(([^)]*)\)/);
        const bodyMatch = raw.match(/{([\s\S]*)}$/);

        const args = argsMatch?.[1]?.trim() ?? '';
        const body = bodyMatch?.[1]?.trim() ?? '';

        return `function ${key}(${args}) {\n  ${body}\n}`;
      }

      return `${key} = ${JSON.stringify(value)};`;
    })
    .join('\n\n');
  }

  importScripts(imports: string[] = []) {
    let script = '';

    imports.forEach((name) => {
      if (name.startsWith('http') || name.startsWith('/') || name.startsWith('./') || name.startsWith('../')) {
        script += `importScripts("${name}");\n`
      }
    });

    return script
  }

  destroy(worker: Worker, workerName: string): void {
    worker?.removeEventListener('message', this.onMessage);
    worker?.terminate();

    if (workerName === WORKER_NAME.MAIN) {
      this.worker = null;
      return;
    }

    (this as any)[workerName] = null;
  }

  on(eventName: string, callback: EventCallback): void {
    if (!this.events[eventName]) {
      this.events[eventName] = [];
    }
    this.events[eventName].push(callback);
  }

  off(eventName: string, callback?: EventCallback): void {
    if (!this.events[eventName]) {
      return
    }

    if (!callback) {
      delete this.events[eventName];
    } else {
      this.events[eventName] = this.events[eventName].filter((cb) => cb !== callback);

      if (this.events[eventName].length === 0) {
        delete this.events[eventName];
      }
    }
  }

  emit(eventName: string, data?: any): void {
    if (!this.events[eventName]) {
      return
    }

    this.events[eventName].forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error in event handler for ${eventName}:`, error);
      }
    });
  }
}

export const MagicWorker = MagicWorkerClass.instance();

export default MagicWorker;