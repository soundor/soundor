export interface Parameter {
  id: string;
  label: string;
}

export interface ProjectConfig {
  name: string;
  runtime: string;
  parameters: Parameter[];
}
