/** Import this module like:

       import * as Schema from "./schema";

*/

import { z } from "zod";

export const ProjectOrder = z.object({
  time: z.string(),
  name: z.string(),
  amount: z.number(),
});
export type ProjectOrder = z.infer<typeof ProjectOrder>;

export const GetProjectCounterResponse = z.object({
  amount: z.number(),
  orders: z.array(ProjectOrder),
});
export type GetProjectCounterResponse = z.infer<
  typeof GetProjectCounterResponse
>;

export const Project = z.object({
  fundingDeadline: z.string(),
  fundingGoal: z.string(),
  refundBonusPercent: z.number().default(20),
  defaultPaymentAmount: z.number().default(89),
  formHeading: z.string(),
  description: z.string(),
  authorName: z.string(),
  authorImageUrl: z.string(),
  authorDescription: z.string(),
  isDraft: z.boolean().default(false),
});
export type Project = z.infer<typeof Project>;

export const GetProjectResponse = z.object({
  project: Project,
});
export type GetProjectResponse = z.infer<typeof GetProjectResponse>;

export const PutProjectBody = z.object({
  project: Project,
});
export type PutProjectBody = z.infer<typeof PutProjectBody>;

export const ProjectBonus = z.object({
  email: z.string(),
  amount: z.number(),
});
export type ProjectBonus = z.infer<typeof ProjectBonus>;

export const GetProjectBonusesResponse = z.object({
  bonuses: z.record(ProjectBonus),
});
export type GetProjectBonusesResponse = z.infer<
  typeof GetProjectBonusesResponse
>;

export const AclUser = z.string().refine((_v) => true); // TODO refine
export type AclUser = z.infer<typeof AclUser>;

export const AclPermission = z.string().refine((_v) => true); // TODO refine
export type AclPermission = z.infer<typeof AclPermission>;

// The key of ACLs
export const AclResource = z.string().refine((_v) => true); // TODO refine
export type AclResource = z.infer<typeof AclResource>;

export const Acl = z.object({
  grants: z.record(AclUser, z.array(AclPermission)),
});
export type Acl = z.infer<typeof Acl>;

export const PostAclsGrantBody = z.object({
  grant: z.object({
    user: AclUser,
    resource: AclResource,
    permissions: z.array(AclPermission),
  }),
});
export type PostAclsGrantBody = z.infer<typeof PostAclsGrantBody>;
