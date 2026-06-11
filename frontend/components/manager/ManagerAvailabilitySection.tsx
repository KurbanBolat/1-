"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import {
  createListingBlock,
  deleteListingBlock,
  getListingRoomAvailability,
  type Listing,
  type ListingBlock,
  type RoomAvailability,
  type RoomType,
  type RoomTypeAvailability,
} from "../../lib/api";

function isoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDaysIso(day: string, offset: number): string {
  const next = new Date(`${day}T00:00:00`);
  next.setDate(next.getDate() + offset);
  return isoDay(next);
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const start = new Date(`${checkIn}T00:00:00Z`).getTime();
  const end = new Date(`${checkOut}T00:00:00Z`).getTime();
  return Math.max(0, Math.round((end - start) / 86400000));
}

function money(value: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value);
}

function exactAvailableCount(room: RoomTypeAvailability, checkIn: string, checkOut: string): number {
  const window = room.available_windows.find((item) => item.check_in <= checkIn && item.check_out >= checkOut);
  return window?.available_count ?? 0;
}

function roomsLabel(value: number): string {
  if (value === 1) return "1 номер";
  if (value > 1 && value < 5) return `${value} номера`;
  return `${value} номеров`;
}

export default function ManagerAvailabilitySection({
  listing,
  token,
  roomTypes,
  blocks,
  onBlocksChange,
  onStatus,
}: {
  listing: Listing | null;
  token: string;
  roomTypes: RoomType[];
  blocks: ListingBlock[];
  onBlocksChange: (blocks: ListingBlock[]) => void;
  onStatus: (message: string) => void;
}) {
  const today = useMemo(() => isoDay(new Date()), []);
  const [checkIn, setCheckIn] = useState(today);
  const [checkOut, setCheckOut] = useState(() => addDaysIso(today, 3));
  const [selectedRoomTypeId, setSelectedRoomTypeId] = useState<string>("");
  const [blockedInventory, setBlockedInventory] = useState(1);
  const [reason, setReason] = useState("");
  const [availability, setAvailability] = useState<RoomAvailability | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const activeRoomTypes = useMemo(
    () => [...roomTypes].filter((room) => room.is_active).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id),
    [roomTypes],
  );
  const roomTypeIds = activeRoomTypes.map((room) => String(room.id)).join(",");
  const roomTypeNameById = useMemo(() => new Map(roomTypes.map((room) => [room.id, room.name])), [roomTypes]);
  const nights = nightsBetween(checkIn, checkOut);
  const dateRangeValid = nights > 0;

  useEffect(() => {
    if (activeRoomTypes.length === 0) return;
    if (selectedRoomTypeId === "all") return;
    if (selectedRoomTypeId === "" || !activeRoomTypes.some((room) => String(room.id) === selectedRoomTypeId)) {
      setSelectedRoomTypeId(String(activeRoomTypes[0].id));
    }
  }, [activeRoomTypes, roomTypeIds, selectedRoomTypeId]);

  useEffect(() => {
    if (!listing || !dateRangeValid) {
      setAvailability(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getListingRoomAvailability({
      listing_id: listing.id,
      from_date: checkIn,
      to_date: checkOut,
    })
      .then((result) => {
        if (!cancelled) setAvailability(result);
      })
      .catch((error) => {
        if (!cancelled) {
          setAvailability(null);
          onStatus(error instanceof Error ? error.message : "Не удалось загрузить доступность номеров");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [listing?.id, checkIn, checkOut, dateRangeValid, refreshKey, onStatus]);

  const availabilityRows = useMemo(() => {
    const rows = availability?.room_types ?? [];
    return [...rows].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
  }, [availability]);

  const selectedAvailability = useMemo(() => {
    if (selectedRoomTypeId === "all") return null;
    const room = availabilityRows.find((item) => String(item.id) === selectedRoomTypeId);
    return room ? exactAvailableCount(room, checkIn, checkOut) : 0;
  }, [availabilityRows, checkIn, checkOut, selectedRoomTypeId]);

  const canCreateBlock =
    Boolean(listing && token && dateRangeValid) &&
    !saving &&
    selectedRoomTypeId !== "" &&
    (selectedRoomTypeId === "all" || (selectedAvailability !== null && blockedInventory <= selectedAvailability));

  function refreshAvailability() {
    setRefreshKey((value) => value + 1);
  }

  async function onCreateBlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!listing || !token || !canCreateBlock) return;
    const isFullListingBlock = selectedRoomTypeId === "all";
    setSaving(true);
    onStatus(isFullListingBlock ? "Закрываю объект на выбранные даты..." : "Блокирую номера выбранной категории...");
    try {
      const saved = await createListingBlock(
        listing.id,
        {
          check_in: checkIn,
          check_out: checkOut,
          reason: reason.trim(),
          room_type_id: isFullListingBlock ? null : Number(selectedRoomTypeId),
          blocked_inventory: isFullListingBlock ? null : blockedInventory,
        },
        token,
      );
      onBlocksChange([...blocks, saved].sort((a, b) => a.check_in.localeCompare(b.check_in) || a.id - b.id));
      setReason("");
      refreshAvailability();
      onStatus("Блокировка добавлена");
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "Ошибка добавления блокировки");
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteBlock(block: ListingBlock) {
    if (!listing || !token || saving) return;
    setSaving(true);
    onStatus(`Удаление блокировки #${block.id}...`);
    try {
      await deleteListingBlock(listing.id, block.id, token);
      onBlocksChange(blocks.filter((item) => item.id !== block.id));
      refreshAvailability();
      onStatus(`Блокировка #${block.id} удалена`);
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "Ошибка удаления блокировки");
    } finally {
      setSaving(false);
    }
  }

  if (!listing) return null;

  return (
    <section className="manager-availability" id="manager-availability">
      <div className="manager-section-head">
        <div>
          <h3>Доступность номеров</h3>
          <p className="desc">Проверка как в Booking: выбранные даты, свободные категории и ручные блокировки по количеству.</p>
        </div>
        <span className="status-pill status-confirmed">{dateRangeValid ? `${nights} ноч.` : "Проверьте даты"}</span>
      </div>

      <div className="manager-availability-controls">
        <label>
          Заезд
          <input type="date" min={today} value={checkIn} onChange={(event) => setCheckIn(event.target.value)} />
        </label>
        <label>
          Выезд
          <input type="date" min={addDaysIso(checkIn, 1)} value={checkOut} onChange={(event) => setCheckOut(event.target.value)} />
        </label>
        <button type="button" className="ghost-btn" onClick={refreshAvailability} disabled={loading || !dateRangeValid}>
          {loading ? "Обновление..." : "Обновить"}
        </button>
      </div>

      <div className="manager-availability-grid">
        {availabilityRows.map((room) => {
          const availableCount = exactAvailableCount(room, checkIn, checkOut);
          const unavailableCount = Math.max(0, room.total_inventory - availableCount);
          const percent = room.total_inventory > 0 ? Math.round((availableCount / room.total_inventory) * 100) : 0;
          return (
            <article key={room.id} className={`manager-availability-card ${availableCount > 0 ? "available" : "sold-out"}`}>
              <div className="manager-item-head">
                <b>{room.name}</b>
                <span className={`status-pill ${availableCount > 0 ? "status-confirmed" : "status-cancelled"}`}>
                  {availableCount > 0 ? "Свободно" : "Нет мест"}
                </span>
              </div>
              <p>{room.description || "Описание не указано"}</p>
              <div className="manager-availability-meter">
                <span style={{ width: `${percent}%` }} />
              </div>
              <div className="manager-item-meta">
                <span>{roomsLabel(availableCount)} свободно</span>
                <span>{roomsLabel(unavailableCount)} занято/блок</span>
                <span>{money(room.nightly_price)} KZT / ночь</span>
                <span>до {room.max_guests} гостей</span>
              </div>
            </article>
          );
        })}
        {availabilityRows.length === 0 ? <p className="desc">Активных категорий для выбранного объекта пока нет.</p> : null}
      </div>

      <form className="booking-form manager-block-form" onSubmit={onCreateBlock}>
        <div className="booking-row">
          <label>
            Что блокируем
            <select value={selectedRoomTypeId} onChange={(event) => setSelectedRoomTypeId(event.target.value)}>
              <option value="" disabled>
                Выберите категорию
              </option>
              {activeRoomTypes.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
              <option value="all">Весь объект</option>
            </select>
          </label>
          <label>
            Количество
            <input
              type="number"
              min={1}
              max={selectedAvailability ?? 500}
              value={blockedInventory}
              onChange={(event) => setBlockedInventory(Math.max(1, Number(event.target.value) || 1))}
              disabled={selectedRoomTypeId === "all"}
            />
          </label>
        </div>
        <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Причина: ремонт, stop-sale, private event" />
        {selectedRoomTypeId !== "all" ? (
          <p className="desc">
            Сейчас доступно для блокировки: {roomsLabel(selectedAvailability ?? 0)} на выбранный диапазон.
          </p>
        ) : (
          <p className="warn-text">Полное закрытие объекта скроет все категории на выбранные даты.</p>
        )}
        <button type="submit" disabled={!canCreateBlock}>
          Добавить блокировку
        </button>
      </form>

      <div className="manager-block-list manager-room-block-list">
        {blocks.map((block) => (
          <article key={block.id} className="manager-block-item">
            <div>
              <b>
                {block.check_in} {"->"} {block.check_out}
              </b>
              <p>
                <span className="manager-block-scope">
                  {block.room_type_id ? roomTypeNameById.get(block.room_type_id) || `Категория #${block.room_type_id}` : "Весь объект"}
                </span>
                {block.room_type_id && block.blocked_inventory ? ` · ${roomsLabel(block.blocked_inventory)}` : " · полное закрытие"}
              </p>
              <small>{block.reason || "Без причины"}</small>
            </div>
            <button type="button" className="ghost-btn" onClick={() => void onDeleteBlock(block)} disabled={saving}>
              Удалить блок
            </button>
          </article>
        ))}
        {blocks.length === 0 ? <p className="desc">Пока нет ручных блокировок.</p> : null}
      </div>
    </section>
  );
}
