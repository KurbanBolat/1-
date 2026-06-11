"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

import {
  createListingRoomType,
  deleteListingRoomType,
  updateListingRoomType,
  type Listing,
  type RoomType,
  type RoomTypePayload,
} from "../../lib/api";

const emptyDraft: RoomTypePayload = {
  name: "",
  description: "",
  nightly_price: 25000,
  total_inventory: 1,
  max_guests: 2,
  bedrooms: 1,
  bathrooms: 1,
  amenities: "WiFi",
  is_active: true,
  sort_order: 0,
};

function draftFromListing(listing: Listing | null): RoomTypePayload {
  if (!listing) return emptyDraft;
  return {
    name: `${listing.property_type.replace("_", " ")} Standard`.replace(/\b\w/g, (letter) => letter.toUpperCase()),
    description: "Основная категория номера для этого объекта.",
    nightly_price: listing.nightly_price,
    total_inventory: 1,
    max_guests: listing.max_guests,
    bedrooms: listing.bedrooms,
    bathrooms: listing.bathrooms,
    amenities: listing.amenities || "WiFi",
    is_active: true,
    sort_order: 0,
  };
}

function money(value: number): string {
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(value);
}

export default function ManagerRoomTypesSection({
  listing,
  token,
  items,
  onItemsChange,
  onStatus,
}: {
  listing: Listing | null;
  token: string;
  items: RoomType[];
  onItemsChange: (items: RoomType[]) => void;
  onStatus: (message: string) => void;
}) {
  const [draft, setDraft] = useState<RoomTypePayload>(() => draftFromListing(listing));
  const [editingRoomTypeId, setEditingRoomTypeId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(draftFromListing(listing));
    setEditingRoomTypeId(null);
  }, [listing?.id]);

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id),
    [items],
  );

  function setField<K extends keyof RoomTypePayload>(key: K, value: RoomTypePayload[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  function resetDraft() {
    setDraft(draftFromListing(listing));
    setEditingRoomTypeId(null);
  }

  function startEdit(item: RoomType) {
    setEditingRoomTypeId(item.id);
    setDraft({
      name: item.name,
      description: item.description,
      nightly_price: item.nightly_price,
      total_inventory: item.total_inventory,
      max_guests: item.max_guests,
      bedrooms: item.bedrooms,
      bathrooms: item.bathrooms,
      amenities: item.amenities,
      is_active: item.is_active,
      sort_order: item.sort_order,
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!listing || !token || saving) return;
    setSaving(true);
    onStatus(editingRoomTypeId ? "Сохранение категории номера..." : "Создание категории номера...");
    try {
      const saved = editingRoomTypeId
        ? await updateListingRoomType(listing.id, editingRoomTypeId, draft, token)
        : await createListingRoomType(listing.id, draft, token);
      onItemsChange(
        editingRoomTypeId
          ? items.map((item) => (item.id === saved.id ? saved : item))
          : [...items, saved],
      );
      onStatus(editingRoomTypeId ? `Категория #${saved.id} обновлена` : `Категория #${saved.id} создана`);
      resetDraft();
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "Ошибка сохранения категории номера");
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(item: RoomType) {
    if (!listing || !token || saving) return;
    setSaving(true);
    try {
      const saved = await updateListingRoomType(listing.id, item.id, { is_active: !item.is_active }, token);
      onItemsChange(items.map((row) => (row.id === saved.id ? saved : row)));
      onStatus(saved.is_active ? "Категория включена" : "Категория выключена");
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "Ошибка изменения статуса категории");
    } finally {
      setSaving(false);
    }
  }

  async function remove(item: RoomType) {
    if (!listing || !token || saving) return;
    if (!confirm(`Удалить категорию "${item.name}"? Если по ней уже есть брони, лучше выключить её.`)) return;
    setSaving(true);
    try {
      await deleteListingRoomType(listing.id, item.id, token);
      onItemsChange(items.filter((row) => row.id !== item.id));
      if (editingRoomTypeId === item.id) resetDraft();
      onStatus("Категория удалена");
    } catch (error) {
      onStatus(error instanceof Error ? error.message : "Ошибка удаления категории");
    } finally {
      setSaving(false);
    }
  }

  if (!listing) return null;

  return (
    <section className="manager-room-types" id="manager-room-types">
      <div className="manager-section-head">
        <div>
          <h3>Типы номеров</h3>
          <p className="desc">Эти категории видят гости, страница объекта и AI-консьерж.</p>
        </div>
        <span className="status-pill status-confirmed">{sortedItems.filter((item) => item.is_active).length} активных</span>
      </div>

      <form className="booking-form manager-room-type-form" onSubmit={onSubmit}>
        <div className="booking-row">
          <input value={draft.name} onChange={(event) => setField("name", event.target.value)} placeholder="Название категории" required />
          <input
            type="number"
            min={1}
            value={draft.nightly_price}
            onChange={(event) => setField("nightly_price", Number(event.target.value))}
            placeholder="Цена за ночь"
            required
          />
        </div>
        <div className="booking-row">
          <input
            type="number"
            min={0}
            value={draft.total_inventory}
            onChange={(event) => setField("total_inventory", Number(event.target.value))}
            placeholder="Количество номеров"
            required
          />
          <input
            type="number"
            min={1}
            value={draft.max_guests}
            onChange={(event) => setField("max_guests", Number(event.target.value))}
            placeholder="Макс. гостей"
            required
          />
        </div>
        <div className="booking-row">
          <input
            type="number"
            min={0}
            value={draft.bedrooms}
            onChange={(event) => setField("bedrooms", Number(event.target.value))}
            placeholder="Спальни"
            required
          />
          <input
            type="number"
            min={0}
            value={draft.bathrooms}
            onChange={(event) => setField("bathrooms", Number(event.target.value))}
            placeholder="Ванные"
            required
          />
        </div>
        <div className="booking-row">
          <input
            type="number"
            min={0}
            value={draft.sort_order}
            onChange={(event) => setField("sort_order", Number(event.target.value))}
            placeholder="Порядок"
            required
          />
          <label className="manager-inline-check">
            Активно
            <input type="checkbox" checked={draft.is_active} onChange={(event) => setField("is_active", event.target.checked)} />
          </label>
        </div>
        <input value={draft.amenities} onChange={(event) => setField("amenities", event.target.value)} placeholder="Удобства через запятую" />
        <textarea value={draft.description} onChange={(event) => setField("description", event.target.value)} placeholder="Описание категории" rows={3} />
        <div className="manager-room-type-actions">
          <button type="submit" disabled={saving}>{editingRoomTypeId ? "Сохранить категорию" : "Добавить категорию"}</button>
          {editingRoomTypeId ? (
            <button type="button" className="ghost-btn" onClick={resetDraft} disabled={saving}>
              Отменить
            </button>
          ) : null}
        </div>
      </form>

      <div className="manager-room-type-list">
        {sortedItems.map((item) => (
          <article key={item.id} className="manager-room-type-item">
            <div>
              <div className="manager-item-head">
                <b>{item.name}</b>
                <span className={`status-pill ${item.is_active ? "status-confirmed" : "status-cancelled"}`}>
                  {item.is_active ? "Активно" : "Выключено"}
                </span>
              </div>
              <p>{item.description || "Описание не указано"}</p>
              <div className="manager-item-meta">
                <span>{money(item.nightly_price)} KZT / ночь</span>
                <span>{item.total_inventory} шт.</span>
                <span>до {item.max_guests} гостей</span>
                <span>{item.bedrooms} сп. · {item.bathrooms} ванн.</span>
              </div>
              {item.amenities ? <small>{item.amenities}</small> : null}
            </div>
            <div className="manager-item-actions">
              <button type="button" className="ghost-btn" onClick={() => startEdit(item)} disabled={saving}>
                Редактировать
              </button>
              <button type="button" className="ghost-btn" onClick={() => toggleActive(item)} disabled={saving}>
                {item.is_active ? "Выключить" : "Включить"}
              </button>
              <button type="button" className="ghost-btn" onClick={() => void remove(item)} disabled={saving}>
                Удалить
              </button>
            </div>
          </article>
        ))}
        {sortedItems.length === 0 ? <p className="desc">Категории еще не добавлены.</p> : null}
      </div>
    </section>
  );
}
