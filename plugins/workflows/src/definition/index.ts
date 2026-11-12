/**
 * 定义层公共出口：校验、payload 模板。
 *
 * @module @buka/dsh-plugin-workflows/definition
 */

export {
  buildTemplateContext,
  containsTemplate,
  inspectPayload,
  type PayloadInspection,
  parseTemplatePath,
  readPath,
  renderPayload,
  type TemplateContextInput,
  type TemplatePath,
  type TemplateReference,
  type TemplateTaskValue,
} from './payload.ts'
export {
  edgeAllowsType,
  findEdge,
  findPosition,
  findTaskType,
  type ValidateDefinitionOptions,
  type ValidateDefinitionResult,
  validateWorkflowDefinition,
} from './validate.ts'
