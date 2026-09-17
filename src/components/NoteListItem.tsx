import { grenadeTypeLabel, type Note } from "../types/note";
import { ChevronRightIcon } from "./icons";

interface NoteListItemProps {
  note: Note;
  selected: boolean;
  onSelect: () => void;
}

export function NoteListItem({ note, selected, onSelect }: NoteListItemProps) {
  return (
    <button
      type="button"
      className={selected ? "note-list-item selected" : "note-list-item"}
      onClick={onSelect}
      aria-current={selected}
    >
      <span className={`type-indicator ${note.grenadeType.toLowerCase()}`} />
      <span className="note-item-content">
        <strong>{note.title}</strong>
        <span className="note-meta-row">
          <span>{note.mapName}</span><i />
          <span className={`side-label ${note.side.toLowerCase()}`}>{note.side}</span><i />
          <span>{grenadeTypeLabel(note.grenadeType)}</span>
        </span>
        <small>{note.startPosition} → {note.targetPosition}</small>
      </span>
      <ChevronRightIcon className="item-chevron" />
    </button>
  );
}
