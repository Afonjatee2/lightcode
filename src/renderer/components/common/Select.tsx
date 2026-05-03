import {
  Label,
  ListBox,
  ListLayout,
  Select as HeroSelect,
  type SelectProps as HeroSelectProps,
  Virtualizer,
} from "@heroui/react";
import {
  LARGE_DROPDOWN_VIRTUALIZATION_THRESHOLD,
  SELECT_DROPDOWN_ROW_HEIGHT,
} from "./dropdownVirtualization";

export interface SelectOption {
  id: string;
  label: string;
}

export interface SelectProps extends Omit<
  HeroSelectProps<object, "single">,
  "children" | "onChange" | "value"
> {
  label?: string;
  options: readonly SelectOption[];
  value?: string | null;
  onChange: (value: string) => void;
}

export function Select(props: SelectProps) {
  const { label, onChange, options, value, ...rest } = props;
  const selectedValue = value && options.some((option) => option.id === value) ? value : null;
  const isVirtualized = options.length > LARGE_DROPDOWN_VIRTUALIZATION_THRESHOLD;
  const listBox = (
    <ListBox {...(isVirtualized ? { className: "max-h-60 overflow-y-auto" } : {})}>
      {options.map((option) => (
        <ListBox.Item key={option.id} id={option.id} textValue={option.label}>
          {option.label}
          <ListBox.ItemIndicator />
        </ListBox.Item>
      ))}
    </ListBox>
  );

  return (
    <HeroSelect
      {...rest}
      value={selectedValue}
      onChange={(nextValue) => onChange(nextValue == null ? "" : String(nextValue))}
    >
      {label ? <Label>{label}</Label> : null}
      <HeroSelect.Trigger>
        <HeroSelect.Value />
        <HeroSelect.Indicator />
      </HeroSelect.Trigger>
      <HeroSelect.Popover>
        {isVirtualized ? (
          <Virtualizer
            layout={ListLayout}
            layoutOptions={{ rowHeight: SELECT_DROPDOWN_ROW_HEIGHT }}
          >
            {listBox}
          </Virtualizer>
        ) : (
          listBox
        )}
      </HeroSelect.Popover>
    </HeroSelect>
  );
}
