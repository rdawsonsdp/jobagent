"use client";

import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Star, GripVertical, Calendar } from "lucide-react";

interface ApplicationCard {
  id: string;
  job_id: string;
  status: string;
  applied_at?: string | null;
  is_favorite?: boolean | null;
  jobs?: {
    title: string;
    company: string | null;
  } | null;
}

type GroupedApplications = Record<string, ApplicationCard[]>;

interface KanbanBoardProps {
  grouped: GroupedApplications;
  updateStatus: (applicationId: string, newStatus: string) => Promise<unknown> | void;
  toggleFavorite: (applicationId: string) => Promise<unknown> | void;
}

const COLUMNS = [
  { id: "saved", label: "Saved", color: "bg-gray-500" },
  { id: "applied", label: "Applied", color: "bg-blue-500" },
  { id: "interviewing", label: "Interviewing", color: "bg-yellow-500" },
  { id: "offer", label: "Offer", color: "bg-green-500" },
  { id: "rejected", label: "Rejected", color: "bg-red-500" },
];

function SortableCard({
  card,
  toggleFavorite,
}: {
  card: ApplicationCard;
  toggleFavorite: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-lg border border-gray-200 bg-white p-3 shadow-sm ${
        isDragging ? "opacity-50 shadow-lg" : ""
      }`}
    >
      <div className="flex items-start gap-2">
        <button
          {...attributes}
          {...listeners}
          className="mt-0.5 cursor-grab text-gray-300 hover:text-gray-400 active:cursor-grabbing shrink-0"
        >
          <GripVertical className="w-4 h-4" />
        </button>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">
            {card.jobs?.title ?? "Unknown Job"}
          </p>
          <p className="text-xs text-gray-500 truncate">
            {card.jobs?.company ?? "Unknown Company"}
          </p>
          {card.applied_at && (
            <span className="inline-flex items-center gap-1 text-xs text-gray-400 mt-1">
              <Calendar className="w-3 h-3" />
              {new Date(card.applied_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
          )}
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(card.id);
          }}
          className={`shrink-0 p-0.5 rounded transition-colors ${
            card.is_favorite
              ? "text-yellow-500 hover:text-yellow-600"
              : "text-gray-300 hover:text-yellow-400"
          }`}
          title={card.is_favorite ? "Remove from favorites" : "Add to favorites"}
        >
          <Star
            className="w-4 h-4"
            fill={card.is_favorite ? "currentColor" : "none"}
          />
        </button>
      </div>
    </div>
  );
}

function DroppableColumn({
  id,
  label,
  color,
  cards,
  toggleFavorite,
}: {
  id: string;
  label: string;
  color: string;
  cards: ApplicationCard[];
  toggleFavorite: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      className={`flex flex-col rounded-xl border bg-gray-50 min-w-[260px] w-[260px] shrink-0 transition-colors ${
        isOver ? "border-blue-300 bg-blue-50/50" : "border-gray-200"
      }`}
    >
      <div className="flex items-center gap-2 p-3 border-b border-gray-200">
        <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
        <h3 className="text-sm font-semibold text-gray-700">{label}</h3>
        <span className="ml-auto rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">
          {cards.length}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className="flex-1 p-2 space-y-2 overflow-y-auto min-h-[200px] max-h-[calc(100vh-280px)]"
      >
        <SortableContext
          items={cards.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          {cards.map((card) => (
            <SortableCard
              key={card.id}
              card={card}
              toggleFavorite={toggleFavorite}
            />
          ))}
        </SortableContext>

        {cards.length === 0 && (
          <div className="flex items-center justify-center h-20 text-xs text-gray-400 border-2 border-dashed border-gray-200 rounded-lg">
            Drop here
          </div>
        )}
      </div>
    </div>
  );
}

function OverlayCard({ card }: { card: ApplicationCard }) {
  return (
    <div className="rounded-lg border border-blue-200 bg-white p-3 shadow-xl w-[240px]">
      <p className="text-sm font-medium text-gray-900 truncate">
        {card.jobs?.title ?? "Unknown Job"}
      </p>
      <p className="text-xs text-gray-500 truncate">
        {card.jobs?.company ?? "Unknown Company"}
      </p>
    </div>
  );
}

export default function KanbanBoard({
  grouped,
  updateStatus,
  toggleFavorite,
}: KanbanBoardProps) {
  const [activeCard, setActiveCard] = useState<ApplicationCard | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor)
  );

  const findCard = (id: string): ApplicationCard | undefined => {
    for (const column of COLUMNS) {
      const cards = grouped[column.id] ?? [];
      const found = cards.find((c) => c.id === id);
      if (found) return found;
    }
    return undefined;
  };

  const findColumn = (id: string): string | undefined => {
    // Check if the id is a column id
    if (COLUMNS.some((c) => c.id === id)) return id;
    // Otherwise find the column that contains this card
    for (const column of COLUMNS) {
      const cards = grouped[column.id] ?? [];
      if (cards.some((c) => c.id === id)) return column.id;
    }
    return undefined;
  };

  const handleDragStart = (event: DragStartEvent) => {
    const card = findCard(event.active.id as string);
    if (card) setActiveCard(card);
  };

  const handleDragOver = (_event: DragOverEvent) => {
    // Handled on drag end
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCard(null);

    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeColumn = findColumn(activeId);
    const overColumn = findColumn(overId);

    if (!activeColumn || !overColumn) return;

    if (activeColumn !== overColumn) {
      updateStatus(activeId, overColumn);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLUMNS.map((column) => (
          <DroppableColumn
            key={column.id}
            id={column.id}
            label={column.label}
            color={column.color}
            cards={grouped[column.id] ?? []}
            toggleFavorite={toggleFavorite}
          />
        ))}
      </div>

      <DragOverlay>
        {activeCard ? <OverlayCard card={activeCard} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
