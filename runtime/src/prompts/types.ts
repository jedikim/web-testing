export interface VersionedPromptTemplate<TInput> {
  id: string;
  version: string;
  render(input: TInput): string;
}

export function promptTag(template: Pick<VersionedPromptTemplate<unknown>, 'id' | 'version'>): string {
  return `${template.id}@${template.version}`;
}

