export type LinkType = 'reference' | 'copy';

export interface Attachment {
  id: string;
  task_id: string;
  name: string;
  link_type: LinkType;
  location: string;
  created_at: number;
}
