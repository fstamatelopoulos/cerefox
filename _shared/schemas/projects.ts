/**
 * Schemas for project CRUD endpoints.
 *
 * Python source: `src/cerefox/api/routes_api.py`
 *   - ProjectResponse  (line 233)
 *
 * Part 24C ships GET only; POST/PUT/DELETE land in Part 24F under the
 * same response schema.
 */

import { z } from "zod";

import { IdentityFields } from "./documents.js";

export const ProjectResponse = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
});
export type ProjectResponse = z.infer<typeof ProjectResponse>;

export const ProjectList = z.array(ProjectResponse);
export type ProjectList = z.infer<typeof ProjectList>;

// CRUD request bodies (Part 24F).

export const CreateProjectRequest = IdentityFields.extend({
  name: z.string().min(1),
  description: z.string().default(""),
});
export type CreateProjectRequest = z.infer<typeof CreateProjectRequest>;

/** Only the fields present are changed; at least one is required. */
export const UpdateProjectRequest = IdentityFields.extend({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
});
export type UpdateProjectRequest = z.infer<typeof UpdateProjectRequest>;

export const SuccessResponse = z.object({ success: z.boolean() });
export type SuccessResponse = z.infer<typeof SuccessResponse>;
