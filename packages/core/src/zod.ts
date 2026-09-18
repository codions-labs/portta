// Zod, imported by name instead of through its `z` namespace object.
//
// `zod`'s entry point binds `z` to `import * as z from "./v4/classic/external.js"`,
// and that module re-exports the locale barrel. A bundler cannot drop members of
// a namespace object reached by property, so `import { z } from 'zod'` pulls in
// all 63 locales and the v3 compatibility tree — around 330 KB per bundle, of
// which only `en` is ever used. Naming the imports lets tree shaking work.
//
// The exported `z` mirrors the members this repository actually uses. Adding a
// new one is a line here; the call sites stay `z.whatever()`.

import type * as zt from 'zod'
import {
  array,
  boolean,
  coerce,
  custom,
  discriminatedUnion,
  email,
  enum as enum_,
  iso,
  lazy,
  literal,
  NEVER,
  null as null_,
  number,
  object,
  record,
  strictObject,
  string,
  toJSONSchema,
  tuple,
  union,
  unknown,
  uuid,
  ZodError,
  ZodObject,
  ZodOptional,
} from 'zod'

export const z = {
  array,
  boolean,
  coerce,
  custom,
  discriminatedUnion,
  email,
  enum: enum_,
  iso,
  lazy,
  literal,
  NEVER,
  null: null_,
  number,
  object,
  record,
  strictObject,
  string,
  toJSONSchema,
  tuple,
  union,
  unknown,
  uuid,
  ZodError,
  ZodObject,
  ZodOptional,
}

// Merged with the constant above so `z.infer<…>` and `z.ZodType` keep working
// at the call sites, which only change the module they import `z` from.
export declare namespace z {
  export type infer<T extends zt.ZodType> = zt.infer<T>
  export type input<T extends zt.ZodType> = zt.input<T>
  export type output<T extends zt.ZodType> = zt.output<T>
  export type ZodType<Output = unknown, Input = unknown> = zt.ZodType<Output, Input>
  export type ZodError<T = unknown> = zt.ZodError<T>
}
