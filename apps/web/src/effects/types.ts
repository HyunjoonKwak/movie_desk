// Effect definitions describe a GPU pass chain. Phase 4 wires this into a
// real WebGL renderer; for now the registry shape is fixed so effect authors
// can land definitions without waiting for the runtime.

interface NumberParam {
  kind: "number";
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

interface BooleanParam {
  kind: "boolean";
  key: string;
  label: string;
  default: boolean;
}

interface ColorParam {
  kind: "color";
  key: string;
  label: string;
  default: string; // hex
}

interface EnumParam {
  kind: "enum";
  key: string;
  label: string;
  options: readonly { value: string; label: string }[];
  default: string;
}

type ParamDef = NumberParam | BooleanParam | ColorParam | EnumParam;

type EffectParams = Readonly<Record<string, number | boolean | string>>;

interface EffectPass {
  readonly shader: string; // identifier into the shader registry
  readonly uniforms: (ctx: { params: EffectParams; width: number; height: number }) => Record<
    string,
    number | readonly number[]
  >;
}

interface EffectDefinitionBase {
  readonly type: string;
  readonly name: string;
  readonly keywords: readonly string[];
  readonly params: readonly ParamDef[];
  readonly passes: readonly EffectPass[];
}

export type EffectDefinition = EffectDefinitionBase &
  (
    | { readonly category: "audio"; readonly workingSpace?: never }
    | {
        readonly category: "color" | "blur" | "stylize" | "transform";
        readonly workingSpace: "linear" | "encoded";
      }
  );
