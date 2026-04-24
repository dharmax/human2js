import vm from "node:vm";
import { 
  Asker, 
  ContextManager, 
  PromptEngine, 
  GenerationResult,
  TaskType
} from "@dharmax/llm-utils";

export interface CompilerOptions {
  asker: Asker;
  contextManager?: ContextManager;
  promptEngine?: PromptEngine;
  systemTemplate?: string;
  actionCatalog?: string[];
  guidelines?: string;
  schemaPrompt?: string;
}

export interface CompilationResult {
  kind: "plan" | "reply";
  code?: string;
  assistantReply?: string;
  intent?: any;
  confidence: number;
  reason?: string;
  raw?: GenerationResult;
}

/**
 * Human2JS Compiler
 * Turns natural language into executable, high-fidelity JavaScript plans.
 */
export class Compiler {
  private asker: Asker;
  private contextManager?: ContextManager;
  private promptEngine?: PromptEngine;
  private systemTemplate: string;
  private actionCatalog: string[];
  private guidelines: string;
  private schemaPrompt: string;

  constructor(options: CompilerOptions) {
    this.asker = options.asker;
    this.contextManager = options.contextManager;
    this.promptEngine = options.promptEngine;
    this.systemTemplate = options.systemTemplate || "You are an expert JS orchestrator. Plan the request.";
    this.actionCatalog = options.actionCatalog || [];
    this.guidelines = options.guidelines || "";
    this.schemaPrompt = options.schemaPrompt || "Return JSON with {kind, code, intent, confidence}.";
  }

  async compile(text: string, options: { 
    taskType?: TaskType;
    history?: any[];
    managedContext?: string;
    groundingContext?: string;
  } = {}): Promise<CompilationResult> {
    const taskType = options.taskType || { 
      id: 'project-planning', 
      shortName: 'plan', 
      description: 'Complex NL-to-JS planning.', 
      weights: { strategy: 0.6, logic: 0.4 } 
    };

    const system = this.buildSystemPrompt(options);
    const prompt = `Request: "${text}"\n\nYour Response (JSON):`;

    const result = await this.asker.ask(prompt, taskType.id, {
      system,
      format: 'json'
    });

    if (!result.ok) {
      throw new Error(`Compilation failed: ${result.error}`);
    }

    try {
      const parsed = JSON.parse(result.text);
      return {
        ...parsed,
        raw: result
      };
    } catch (e: any) {
      // Fallback for markdown-wrapped JSON
      const match = result.text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (match) {
        return {
          ...JSON.parse(match[1]),
          raw: result
        };
      }
      throw new Error(`Failed to parse compiled JS: ${e.message}`);
    }
  }

  private buildSystemPrompt(options: any): string {
    const lines = [this.systemTemplate];
    
    if (this.actionCatalog.length > 0) {
      lines.push("\n### Available Actions", this.actionCatalog.join(", "));
    }

    if (options.managedContext) {
      lines.push("\n### Context (Condensed)", options.managedContext);
    }

    if (options.groundingContext) {
      lines.push("\n### Grounding Info", options.groundingContext);
    }

    if (this.guidelines) {
      lines.push("\n### Guidelines", this.guidelines);
    }

    lines.push("\n### Schema Requirements", this.schemaPrompt);

    return lines.join("\n");
  }
}

/**
 * Human2JS Orchestrator
 * Provides a persistent, stateful execution environment for compiled JS.
 */
export class Orchestrator {
  private services: Record<string, any>;
  private workflowStore: any;

  constructor(options: { 
    services?: Record<string, any>;
    workflowStore?: any;
  } = {}) {
    this.services = options.services || {};
    this.workflowStore = options.workflowStore;
  }

  async execute(code: string, options: { 
    runId?: string;
    initialState?: any;
    traceWorkflow?: (event: any) => void;
  } = {}): Promise<any> {
    const sandbox = this.createSandbox(options);
    const trimmedCode = this.sanitizeCode(code);

    const argKeys = Object.keys(sandbox);
    const argValues = Object.values(sandbox);
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

    try {
      let userFn;
      if (trimmedCode.startsWith("async") || trimmedCode.startsWith("function")) {
        const context = vm.createContext(sandbox);
        userFn = vm.runInContext(`(${trimmedCode})`, context);
      } else {
        userFn = new AsyncFunction(...argKeys, trimmedCode);
      }

      const result = await userFn(...argValues);

      return result;
    } catch (error: any) {
      throw new Error(`Execution failed: ${error.message}`);
    }
  }

  private createSandbox(options: any) {
    return {
      ...this.services,
      // Core helpers (placeholder implementations - these should ideally be passed in or managed via a Session class)
      step: async (id: string, desc: string, fn: Function) => {
        console.log(`[Step:${id}] ${desc}`);
        return fn();
      },
      transition: async (to: string, trigger: string, fn: Function) => {
        console.log(`[Transition:${to}] trigger: ${trigger}`);
        return fn();
      },
      getState: () => options.initialState || {},
      setState: (state: any) => { options.initialState = state; },
      
      console,
      process: {
        cwd: () => process.cwd(),
        env: { ...process.env }
      }
    };
  }

  private sanitizeCode(code: string): string {
    return code.trim()
      .replace(/^```javascript/, "")
      .replace(/^```js/, "")
      .replace(/^```/, "")
      .replace(/```$/, "");
  }
}
