// ============ ITEMS CORE ============
// Каталог предметов и правила снаряжения по упрощённым правилам D&D 5e (SRD).
// Общий для браузера и сервера: сервер по этим же правилам проверяет «надеть», «использовать» и т.п.
//
// Поля предмета:
//   slot      — куда надевается: head, neck, cloak, chest, hands, legs, feet, ring, weapon, shield
//   weapon    — { dice, type, props: [...], versatile, range, bonus, extra: { dice, type } }
//               props: finesse (фехтовальное), light (лёгкое), heavy (тяжёлое), two (двуручное),
//                      thrown (метательное), ranged (дальнобойное), loading (перезарядка)
//   armor     — { kind: light|medium|heavy|shield, ac, bonus, str, stealth }
//   mods      — постоянные бонусы, пока предмет надет: ac, saves, attack, damage, spell, speed,
//               setStr/setDex/setCon/setInt/setWis/setCha (характеристика становится не ниже N)
//   use       — что делает «Использовать»: heal | buff | spell | revive | text
//   charges   — у жезлов: сколько применений
(function (root) {
  'use strict';

  const SLOTS = [
    { id: 'head', label: 'Голова', icon: '⛑' },
    { id: 'neck', label: 'Шея', icon: '📿' },
    { id: 'cloak', label: 'Плащ', icon: '🧥' },
    { id: 'chest', label: 'Доспех', icon: '🦺' },
    { id: 'hands', label: 'Руки', icon: '🧤' },
    { id: 'legs', label: 'Ноги', icon: '👖' },
    { id: 'feet', label: 'Обувь', icon: '👢' },
    { id: 'mainhand', label: 'Основная рука', icon: '⚔' },
    { id: 'offhand', label: 'Вторая рука', icon: '🛡' },
    { id: 'ring1', label: 'Кольцо', icon: '💍' },
    { id: 'ring2', label: 'Кольцо', icon: '💍' },
  ];
  const SLOT_IDS = SLOTS.map(s => s.id);

  const ABILITIES = [
    { id: 'str', label: 'СИЛ', name: 'Сила' }, { id: 'dex', label: 'ЛОВ', name: 'Ловкость' },
    { id: 'con', label: 'ТЕЛ', name: 'Телосложение' }, { id: 'int', label: 'ИНТ', name: 'Интеллект' },
    { id: 'wis', label: 'МДР', name: 'Мудрость' }, { id: 'cha', label: 'ХАР', name: 'Харизма' },
  ];

  const PROPS = {
    finesse: 'фехтовальное', light: 'лёгкое', heavy: 'тяжёлое', two: 'двуручное',
    thrown: 'метательное', ranged: 'дальнобойное', loading: 'перезарядка',
  };

  const CATEGORIES = {
    all: { label: 'Все', icon: '📦' },
    weapon: { label: 'Оружие', icon: '⚔' },
    armor: { label: 'Доспехи', icon: '🛡' },
    gear: { label: 'Одежда', icon: '👢' },
    jewelry: { label: 'Украшения', icon: '💍' },
    potion: { label: 'Зелья', icon: '🧪' },
    scroll: { label: 'Свитки', icon: '📜' },
    tool: { label: 'Снаряжение', icon: '🎒' },
    treasure: { label: 'Сокровища', icon: '💰' },
    chest: { label: 'Сундуки', icon: '📦' },
  };

  const W = (dice, type, props = [], extra = {}) => ({ dice, type, props, ...extra });

  const CATALOG = [
    /* ───── Оружие (обычное) ───── */
    { id: 'dagger', name: 'Кинжал', icon: '🗡', category: 'weapon', rarity: 'common', price: 2, slot: 'weapon', weapon: W('1d4', 'колющий', ['finesse', 'light', 'thrown'], { range: '6/18 м' }) },
    { id: 'sword_short', name: 'Короткий меч', icon: '🗡', category: 'weapon', rarity: 'common', price: 10, slot: 'weapon', weapon: W('1d6', 'колющий', ['finesse', 'light']) },
    { id: 'sword_long', name: 'Длинный меч', icon: '⚔', category: 'weapon', rarity: 'common', price: 15, slot: 'weapon', weapon: W('1d8', 'рубящий', [], { versatile: '1d10' }) },
    { id: 'sword_great', name: 'Двуручный меч', icon: '⚔', category: 'weapon', rarity: 'common', price: 50, slot: 'weapon', weapon: W('2d6', 'рубящий', ['heavy', 'two']) },
    { id: 'rapier', name: 'Рапира', icon: '🤺', category: 'weapon', rarity: 'common', price: 25, slot: 'weapon', weapon: W('1d8', 'колющий', ['finesse']) },
    { id: 'axe_hand', name: 'Ручной топор', icon: '🪓', category: 'weapon', rarity: 'common', price: 5, slot: 'weapon', weapon: W('1d6', 'рубящий', ['light', 'thrown'], { range: '6/18 м' }) },
    { id: 'axe_battle', name: 'Боевой топор', icon: '🪓', category: 'weapon', rarity: 'common', price: 10, slot: 'weapon', weapon: W('1d8', 'рубящий', [], { versatile: '1d10' }) },
    { id: 'axe_great', name: 'Секира', icon: '🪓', category: 'weapon', rarity: 'common', price: 30, slot: 'weapon', weapon: W('1d12', 'рубящий', ['heavy', 'two']) },
    { id: 'mace', name: 'Булава', icon: '🔨', category: 'weapon', rarity: 'common', price: 5, slot: 'weapon', weapon: W('1d6', 'дробящий') },
    { id: 'hammer_war', name: 'Боевой молот', icon: '🔨', category: 'weapon', rarity: 'common', price: 15, slot: 'weapon', weapon: W('1d8', 'дробящий', [], { versatile: '1d10' }) },
    { id: 'spear', name: 'Копьё', icon: '🔱', category: 'weapon', rarity: 'common', price: 1, slot: 'weapon', weapon: W('1d6', 'колющий', ['thrown'], { versatile: '1d8', range: '6/18 м' }) },
    { id: 'staff', name: 'Боевой посох', icon: '🦯', category: 'weapon', rarity: 'common', price: 1, slot: 'weapon', weapon: W('1d6', 'дробящий', [], { versatile: '1d8' }) },
    { id: 'bow_short', name: 'Короткий лук', icon: '🏹', category: 'weapon', rarity: 'common', price: 25, slot: 'weapon', weapon: W('1d6', 'колющий', ['ranged', 'two'], { range: '24/96 м' }) },
    { id: 'bow_long', name: 'Длинный лук', icon: '🏹', category: 'weapon', rarity: 'common', price: 50, slot: 'weapon', weapon: W('1d8', 'колющий', ['ranged', 'heavy', 'two'], { range: '45/180 м' }) },
    { id: 'crossbow_light', name: 'Лёгкий арбалет', icon: '🏹', category: 'weapon', rarity: 'common', price: 25, slot: 'weapon', weapon: W('1d8', 'колющий', ['ranged', 'two', 'loading'], { range: '24/96 м' }) },
    { id: 'crossbow_hand', name: 'Ручной арбалет', icon: '🏹', category: 'weapon', rarity: 'common', price: 75, slot: 'weapon', weapon: W('1d6', 'колющий', ['ranged', 'light', 'loading'], { range: '9/36 м' }) },

    /* ───── Оружие (магическое) ───── */
    { id: 'sword_long_plus1', name: 'Длинный меч +1', icon: '⚔', category: 'weapon', rarity: 'uncommon', price: 500, slot: 'weapon', weapon: W('1d8', 'рубящий', [], { versatile: '1d10', bonus: 1 }) },
    { id: 'bow_long_plus1', name: 'Длинный лук +1', icon: '🏹', category: 'weapon', rarity: 'uncommon', price: 500, slot: 'weapon', weapon: W('1d8', 'колющий', ['ranged', 'heavy', 'two'], { range: '45/180 м', bonus: 1 }) },
    { id: 'dagger_poison', name: 'Отравленный кинжал', icon: '🗡', category: 'weapon', rarity: 'uncommon', price: 400, slot: 'weapon', desc: 'Клинок всегда покрыт ядом.', weapon: W('1d4', 'колющий', ['finesse', 'light', 'thrown'], { range: '6/18 м', extra: { dice: '1d4', type: 'ядом' } }) },
    { id: 'staff_arcane', name: 'Посох мага', icon: '🪄', category: 'weapon', rarity: 'uncommon', price: 600, slot: 'weapon', desc: 'Фокус для заклинаний.', weapon: W('1d6', 'дробящий', [], { versatile: '1d8' }), mods: { spell: 1 } },
    { id: 'sword_flame', name: 'Пылающий клинок', icon: '🔥', category: 'weapon', rarity: 'rare', price: 5000, slot: 'weapon', desc: 'Длинный меч, объятый пламенем.', weapon: W('1d8', 'рубящий', [], { versatile: '1d10', extra: { dice: '2d6', type: 'огнём' } }) },
    { id: 'hammer_plus2', name: 'Боевой молот +2', icon: '🔨', category: 'weapon', rarity: 'rare', price: 4000, slot: 'weapon', weapon: W('1d8', 'дробящий', [], { versatile: '1d10', bonus: 2 }) },

    /* ───── Доспехи ───── */
    { id: 'armor_padded', name: 'Стёганый доспех', icon: '🦺', category: 'armor', rarity: 'common', price: 5, slot: 'chest', armor: { kind: 'light', ac: 11, stealth: true } },
    { id: 'armor_leather', name: 'Кожаный доспех', icon: '🦺', category: 'armor', rarity: 'common', price: 10, slot: 'chest', armor: { kind: 'light', ac: 11 } },
    { id: 'armor_studded', name: 'Проклёпанная кожа', icon: '🦺', category: 'armor', rarity: 'common', price: 45, slot: 'chest', armor: { kind: 'light', ac: 12 } },
    { id: 'armor_chain_shirt', name: 'Кольчужная рубаха', icon: '🦺', category: 'armor', rarity: 'common', price: 50, slot: 'chest', armor: { kind: 'medium', ac: 13 } },
    { id: 'armor_scale', name: 'Чешуйчатый доспех', icon: '🦺', category: 'armor', rarity: 'common', price: 50, slot: 'chest', armor: { kind: 'medium', ac: 14, stealth: true } },
    { id: 'armor_half', name: 'Полулаты', icon: '🦺', category: 'armor', rarity: 'uncommon', price: 750, slot: 'chest', armor: { kind: 'medium', ac: 15, stealth: true } },
    { id: 'armor_chain', name: 'Кольчуга', icon: '🛡', category: 'armor', rarity: 'common', price: 75, slot: 'chest', armor: { kind: 'heavy', ac: 16, str: 13, stealth: true } },
    { id: 'armor_plate', name: 'Латы', icon: '🛡', category: 'armor', rarity: 'uncommon', price: 1500, slot: 'chest', armor: { kind: 'heavy', ac: 18, str: 15, stealth: true } },
    { id: 'shield_wooden', name: 'Щит', icon: '🛡', category: 'armor', rarity: 'common', price: 10, slot: 'shield', armor: { kind: 'shield', ac: 2 } },
    { id: 'shield_plus1', name: 'Щит +1', icon: '🛡', category: 'armor', rarity: 'uncommon', price: 500, slot: 'shield', armor: { kind: 'shield', ac: 2, bonus: 1 } },
    { id: 'armor_leather_plus1', name: 'Кожаный доспех +1', icon: '🦺', category: 'armor', rarity: 'rare', price: 1500, slot: 'chest', armor: { kind: 'light', ac: 11, bonus: 1 } },
    { id: 'armor_chain_plus1', name: 'Кольчуга +1', icon: '🛡', category: 'armor', rarity: 'rare', price: 2000, slot: 'chest', armor: { kind: 'heavy', ac: 16, bonus: 1, str: 13, stealth: true } },

    /* ───── Одежда: голова, плащ, руки, ноги, обувь ───── */
    { id: 'helmet', name: 'Шлем', icon: '⛑', category: 'gear', rarity: 'common', price: 5, slot: 'head', desc: 'Обычный шлем. По правилам 5e защиту даёт доспех, шлем — для вида.' },
    { id: 'helmet_guard', name: 'Шлем стража', icon: '⛑', category: 'gear', rarity: 'uncommon', price: 400, slot: 'head', desc: 'Зачарованный шлем.', mods: { ac: 1 } },
    { id: 'headband_intellect', name: 'Обруч интеллекта', icon: '👑', category: 'gear', rarity: 'uncommon', price: 800, slot: 'head', mods: { setInt: 19 } },
    { id: 'cloak_travel', name: 'Дорожный плащ', icon: '🧥', category: 'gear', rarity: 'common', price: 1, slot: 'cloak', desc: 'Защищает от дождя и ветра.' },
    { id: 'cloak_protection', name: 'Плащ защиты', icon: '🧥', category: 'gear', rarity: 'uncommon', price: 600, slot: 'cloak', mods: { ac: 1, saves: 1 } },
    { id: 'cloak_elven', name: 'Эльфийский плащ', icon: '🧥', category: 'gear', rarity: 'uncommon', price: 500, slot: 'cloak', desc: 'Капюшон скрывает: помеха врагам на Восприятие, чтобы заметить вас; преимущество на Скрытность.' },
    { id: 'gloves_leather', name: 'Кожаные перчатки', icon: '🧤', category: 'gear', rarity: 'common', price: 1, slot: 'hands', desc: 'Простые рабочие перчатки.' },
    { id: 'gloves_ogre', name: 'Перчатки силы огра', icon: '🧤', category: 'gear', rarity: 'uncommon', price: 800, slot: 'hands', mods: { setStr: 19 } },
    { id: 'gloves_thievery', name: 'Перчатки ловкача', icon: '🧤', category: 'gear', rarity: 'uncommon', price: 500, slot: 'hands', desc: '+5 к проверкам Ловкости рук и вскрытия замков.' },
    { id: 'pants_travel', name: 'Дорожные штаны', icon: '👖', category: 'gear', rarity: 'common', price: 1, slot: 'legs', desc: 'Прочные штаны путешественника.' },
    { id: 'pants_swift', name: 'Штаны быстроногого', icon: '👖', category: 'gear', rarity: 'uncommon', price: 400, slot: 'legs', desc: 'Скорость +1,5 м.', mods: { speed: 1.5 } },
    { id: 'boots_leather', name: 'Кожаные сапоги', icon: '👢', category: 'gear', rarity: 'common', price: 1, slot: 'feet', desc: 'Обычные сапоги.' },
    { id: 'boots_elven', name: 'Эльфийские сапоги', icon: '👢', category: 'gear', rarity: 'uncommon', price: 500, slot: 'feet', desc: 'Шаги беззвучны: преимущество на Скрытность при передвижении.' },
    { id: 'boots_striding', name: 'Сапоги-скороходы', icon: '👢', category: 'gear', rarity: 'uncommon', price: 800, slot: 'feet', desc: 'Скорость +3 м, прыжки в 3 раза дальше.', mods: { speed: 3 } },

    /* ───── Украшения: амулеты и кольца ───── */
    { id: 'amulet_health', name: 'Амулет здоровья', icon: '📿', category: 'jewelry', rarity: 'rare', price: 2000, slot: 'neck', mods: { setCon: 19 } },
    { id: 'periapt_wound', name: 'Амулет закрытия ран', icon: '📿', category: 'jewelry', rarity: 'uncommon', price: 600, slot: 'neck', desc: 'При 0 хитов вы сразу стабилизируетесь. Кости хитов на отдыхе лечат вдвое больше.' },
    { id: 'amulet_antipoison', name: 'Амулет защиты от яда', icon: '📿', category: 'jewelry', rarity: 'rare', price: 1500, slot: 'neck', desc: 'Иммунитет к урону ядом и состоянию «отравлен».' },
    { id: 'ring_protection', name: 'Кольцо защиты', icon: '💍', category: 'jewelry', rarity: 'rare', price: 3500, slot: 'ring', mods: { ac: 1, saves: 1 } },
    { id: 'ring_fire', name: 'Кольцо стойкости к огню', icon: '💍', category: 'jewelry', rarity: 'rare', price: 2000, slot: 'ring', desc: 'Сопротивление урону огнём (урон вдвое меньше).' },
    { id: 'ring_jumping', name: 'Кольцо прыжков', icon: '💍', category: 'jewelry', rarity: 'uncommon', price: 500, slot: 'ring', desc: 'Прыжки в 3 раза дальше.' },
    { id: 'ring_swimming', name: 'Кольцо плавания', icon: '💍', category: 'jewelry', rarity: 'uncommon', price: 500, slot: 'ring', desc: 'Скорость плавания 12 м.' },

    /* ───── Зелья ───── */
    { id: 'potion_healing', name: 'Зелье лечения', icon: '🧪', category: 'potion', rarity: 'common', price: 50, use: { kind: 'heal', dice: '2d4+2' } },
    { id: 'potion_greater_heal', name: 'Зелье большого лечения', icon: '🧪', category: 'potion', rarity: 'uncommon', price: 150, use: { kind: 'heal', dice: '4d4+4' } },
    { id: 'potion_superior_heal', name: 'Зелье превосходного лечения', icon: '🧪', category: 'potion', rarity: 'rare', price: 500, use: { kind: 'heal', dice: '8d4+8' } },
    { id: 'potion_giant_str', name: 'Зелье силы великана', icon: '💪', category: 'potion', rarity: 'uncommon', price: 300, use: { kind: 'buff', name: 'Сила великана', rounds: null, duration: '1 час', mods: { setStr: 21 } } },
    { id: 'potion_heroism', name: 'Зелье героизма', icon: '🦸', category: 'potion', rarity: 'rare', price: 500, use: { kind: 'buff', name: 'Героизм', rounds: null, duration: '1 час', mods: { attack: 2, saves: 2 } } },
    { id: 'potion_speed', name: 'Зелье скорости', icon: '⚡', category: 'potion', rarity: 'very-rare', price: 2500, use: { kind: 'buff', name: 'Ускорение', rounds: 10, duration: '1 минуту', mods: { ac: 2, speed: 9 }, text: 'Скорость удвоена, лишнее действие в ход.' } },
    { id: 'potion_invisibility', name: 'Зелье невидимости', icon: '💨', category: 'potion', rarity: 'very-rare', price: 2000, use: { kind: 'buff', name: 'Невидимость', rounds: null, duration: '1 час', mods: {}, text: 'Невидим, пока не атакует или не колдует.' } },
    { id: 'potion_fire_breath', name: 'Зелье огненного дыхания', icon: '🐉', category: 'potion', rarity: 'uncommon', price: 300, use: { kind: 'spell', dice: '4d6', type: 'огнём', save: 'ЛОВ КС 13, половина урона', text: 'Выдыхаете пламя в цель в пределах 9 м.' } },
    { id: 'antitoxin', name: 'Противоядие', icon: '🧴', category: 'potion', rarity: 'common', price: 50, use: { kind: 'buff', name: 'Противоядие', rounds: null, duration: '1 час', mods: {}, text: 'Преимущество на спасброски от яда.' } },
    { id: 'poison_vial', name: 'Яд для оружия', icon: '☠', category: 'potion', rarity: 'common', price: 100, use: { kind: 'buff', name: 'Отравленное оружие', rounds: 10, duration: '1 минуту', mods: { extraDamage: { dice: '1d4', type: 'ядом' } } } },

    /* ───── Свитки и жезлы ───── */
    { id: 'scroll_cure', name: 'Свиток лечения ран', icon: '📜', category: 'scroll', rarity: 'common', price: 50, use: { kind: 'heal', dice: '1d8+3' } },
    { id: 'scroll_missile', name: 'Свиток магической стрелы', icon: '📜', category: 'scroll', rarity: 'common', price: 50, use: { kind: 'spell', dice: '3d4+3', type: 'силовым полем', text: 'Три светящиеся стрелы, всегда попадают.' } },
    { id: 'scroll_shield', name: 'Свиток щита', icon: '📜', category: 'scroll', rarity: 'common', price: 50, use: { kind: 'buff', name: 'Щит', rounds: 1, duration: '1 раунд', mods: { ac: 5 } } },
    { id: 'scroll_fireball', name: 'Свиток огненного шара', icon: '📜', category: 'scroll', rarity: 'uncommon', price: 300, use: { kind: 'spell', dice: '8d6', type: 'огнём', save: 'ЛОВ КС 15, половина урона', text: 'Взрыв радиусом 6 м.' } },
    { id: 'scroll_revivify', name: 'Свиток возрождения', icon: '📜', category: 'scroll', rarity: 'uncommon', price: 300, use: { kind: 'revive', text: 'Возвращает к жизни с 1 хитом (если смерть была не больше минуты назад).' } },
    { id: 'wand_magic_missile', name: 'Жезл магических стрел', icon: '🪄', category: 'scroll', rarity: 'uncommon', price: 800, charges: 7, use: { kind: 'spell', dice: '3d4+3', type: 'силовым полем', text: 'Три стрелы, всегда попадают.' } },

    /* ───── Снаряжение и сокровища ───── */
    { id: 'torch', name: 'Факел', icon: '🔥', category: 'tool', rarity: 'common', price: 0.01, desc: 'Яркий свет 6 м на 1 час.' },
    { id: 'rope', name: 'Верёвка (15 м)', icon: '🪢', category: 'tool', rarity: 'common', price: 1, desc: 'Пеньковая верёвка.' },
    { id: 'rations', name: 'Рацион (1 день)', icon: '🍖', category: 'tool', rarity: 'common', price: 0.5, desc: 'Сухари, вяленое мясо, сыр.' },
    { id: 'healers_kit', name: 'Набор целителя', icon: '🩹', category: 'tool', rarity: 'common', price: 5, desc: 'Стабилизировать существо с 0 хитов без проверки.' },
    { id: 'thieves_tools', name: 'Воровские инструменты', icon: '🔧', category: 'tool', rarity: 'common', price: 25, desc: 'Отмычки для замков и ловушек.' },
    { id: 'bag_holding', name: 'Сума хранения', icon: '👜', category: 'tool', rarity: 'uncommon', price: 500, desc: 'Внутри больше, чем снаружи: до 250 кг.' },
    { id: 'key_iron', name: 'Железный ключ', icon: '🗝', category: 'tool', rarity: 'common', price: 0, desc: 'Открывает какой-то замок.' },
    { id: 'map_treasure', name: 'Карта сокровищ', icon: '🗺', category: 'treasure', rarity: 'uncommon', price: 0, desc: 'Ведёт к тайнику.' },
    { id: 'gems', name: 'Драгоценный камень', icon: '💎', category: 'treasure', rarity: 'uncommon', price: 50, desc: 'Можно продать за 50 зм.' },
    { id: 'gold_pile', name: 'Куча золота', icon: '💰', category: 'treasure', rarity: 'common', price: 0, desc: '50–300 золотых монет — при подборе становятся деньгами.' },

    /* ───── Сундуки (ставятся на карту) ───── */
    { id: 'chest_wooden', name: 'Деревянный сундук', icon: '📦', category: 'chest', rarity: 'common', desc: 'Обычный сундук.', isLootChest: true, lootPool: 'basic' },
    { id: 'chest_locked', name: 'Запертый сундук', icon: '🔒', category: 'chest', rarity: 'uncommon', desc: 'Замок (КС 15).', isLootChest: true, lootPool: 'valuable' },
    { id: 'chest_treasure', name: 'Сундук с сокровищами', icon: '💎', category: 'chest', rarity: 'rare', desc: 'Блестит от золота!', isLootChest: true, lootPool: 'treasure' },
    { id: 'chest_trapped', name: 'Сундук с ловушкой', icon: '⚠', category: 'chest', rarity: 'rare', desc: 'Осторожно! Ловушка.', isLootChest: true, lootPool: 'trapped' },
    { id: 'chest_ancient', name: 'Древний сундук', icon: '🗝', category: 'chest', rarity: 'very-rare', desc: 'Покрыт рунами.', isLootChest: true, lootPool: 'ancient' },
  ];

  const POOLS = {
    basic: [
      { itemId: 'gold_pile', chance: 0.7, qty: [1, 1] }, { itemId: 'torch', chance: 0.5, qty: [1, 3] },
      { itemId: 'rations', chance: 0.4, qty: [1, 3] }, { itemId: 'potion_healing', chance: 0.4, qty: [1, 2] },
      { itemId: 'dagger', chance: 0.2, qty: [1, 1] }, { itemId: 'rope', chance: 0.2, qty: [1, 1] },
    ],
    valuable: [
      { itemId: 'gold_pile', chance: 1.0, qty: [1, 2] }, { itemId: 'gems', chance: 0.6, qty: [1, 3] },
      { itemId: 'potion_healing', chance: 0.6, qty: [1, 2] }, { itemId: 'scroll_cure', chance: 0.3, qty: [1, 1] },
      { itemId: 'potion_greater_heal', chance: 0.25, qty: [1, 1] }, { itemId: 'antitoxin', chance: 0.2, qty: [1, 1] },
      { itemId: 'shield_plus1', chance: 0.08, qty: [1, 1] }, { itemId: 'cloak_protection', chance: 0.06, qty: [1, 1] },
    ],
    treasure: [
      { itemId: 'gold_pile', chance: 1.0, qty: [2, 4] }, { itemId: 'gems', chance: 1.0, qty: [2, 4] },
      { itemId: 'potion_greater_heal', chance: 0.5, qty: [1, 2] }, { itemId: 'scroll_fireball', chance: 0.2, qty: [1, 1] },
      { itemId: 'sword_long_plus1', chance: 0.12, qty: [1, 1] }, { itemId: 'boots_striding', chance: 0.1, qty: [1, 1] },
      { itemId: 'ring_protection', chance: 0.06, qty: [1, 1] }, { itemId: 'amulet_health', chance: 0.05, qty: [1, 1] },
    ],
    trapped: [
      { itemId: 'gold_pile', chance: 1.0, qty: [2, 3] }, { itemId: 'gems', chance: 0.8, qty: [1, 3] },
      { itemId: 'poison_vial', chance: 0.5, qty: [1, 2] }, { itemId: 'dagger_poison', chance: 0.15, qty: [1, 1] },
      { itemId: 'potion_heroism', chance: 0.12, qty: [1, 1] }, { itemId: 'gloves_thievery', chance: 0.1, qty: [1, 1] },
    ],
    ancient: [
      { itemId: 'gold_pile', chance: 1.0, qty: [3, 6] }, { itemId: 'gems', chance: 1.0, qty: [3, 6] },
      { itemId: 'potion_superior_heal', chance: 0.5, qty: [1, 1] }, { itemId: 'scroll_revivify', chance: 0.3, qty: [1, 1] },
      { itemId: 'headband_intellect', chance: 0.12, qty: [1, 1] }, { itemId: 'sword_flame', chance: 0.1, qty: [1, 1] },
      { itemId: 'armor_chain_plus1', chance: 0.08, qty: [1, 1] }, { itemId: 'potion_speed', chance: 0.06, qty: [1, 1] },
    ],
  };

  const BY_ID = new Map(CATALOG.map(i => [i.id, i]));

  /* ---------- кости ---------- */

  function parseDice(expr) {
    const m = String(expr || '').replace(/\s/g, '').match(/^(\d*)d(\d+)([+-]\d+)?$/i);
    if (m) return { n: Number(m[1] || 1), sides: Number(m[2]), mod: Number(m[3] || 0) };
    const flat = Number(expr);
    return Number.isFinite(flat) ? { n: 0, sides: 0, mod: flat } : null;
  }
  const diceMin = e => { const d = parseDice(e); return d ? d.n + d.mod : 0; };
  const diceMax = e => { const d = parseDice(e); return d ? d.n * d.sides + d.mod : 0; };
  function rollDice(expr, crit) {
    const d = parseDice(expr);
    if (!d) return { total: 0, rolls: [] };
    const n = d.n * (crit ? 2 : 1), rolls = [];
    for (let i = 0; i < n; i++) rolls.push(1 + Math.floor(Math.random() * d.sides));
    return { total: rolls.reduce((s, x) => s + x, 0) + d.mod, rolls, mod: d.mod };
  }

  /* ---------- описание предмета ---------- */

  /** Механика предмета: из каталога по id, у своих предметов мастера — из item.mech. */
  function defOf(item) {
    if (!item) return null;
    const base = BY_ID.get(item.id);
    if (base) return base;
    return item.mech && typeof item.mech === 'object' ? { ...item.mech, id: item.id, name: item.name, icon: item.icon } : null;
  }

  const signed = n => (n >= 0 ? `+${n}` : `${n}`);
  const fmtMods = mods => {
    const out = [];
    if (!mods) return out;
    if (mods.ac) out.push(`КД ${signed(mods.ac)}`);
    if (mods.attack) out.push(`атака ${signed(mods.attack)}`);
    if (mods.damage) out.push(`урон ${signed(mods.damage)}`);
    if (mods.saves) out.push(`спасброски ${signed(mods.saves)}`);
    if (mods.spell) out.push(`заклинания ${signed(mods.spell)} к атаке и КС`);
    if (mods.speed) out.push(`скорость ${signed(mods.speed)} м`);
    for (const a of ABILITIES) {
      const v = mods['set' + a.id[0].toUpperCase() + a.id.slice(1)];
      if (v) out.push(`${a.name} становится ${v}`);
    }
    if (mods.extraDamage) out.push(`атаки оружием +${mods.extraDamage.dice} ${mods.extraDamage.type}`);
    return out;
  };

  /** Понятное описание: что делает предмет. */
  function describe(item) {
    const d = defOf(item);
    if (!d) return item?.desc || 'Без особых свойств.';
    const parts = [];
    if (d.weapon) {
      const w = d.weapon;
      let s = `Урон ${w.dice}${w.bonus ? signed(w.bonus) : ''} ${w.type}`;
      if (w.versatile) s += ` (двумя руками ${w.versatile})`;
      if (w.extra) s += ` + ${w.extra.dice} ${w.extra.type}`;
      parts.push(s);
      if (w.bonus) parts.push(`${signed(w.bonus)} к атаке`);
      const props = (w.props || []).map(p => PROPS[p]).filter(Boolean);
      if (props.length) parts.push(props.join(', '));
      if (w.range) parts.push(`дальность ${w.range}`);
    }
    if (d.armor) {
      const a = d.armor;
      if (a.kind === 'shield') parts.push(`КД +${a.ac + (a.bonus || 0)}, держится во второй руке`);
      else {
        const dex = a.kind === 'light' ? ' + ЛОВ' : a.kind === 'medium' ? ' + ЛОВ (макс. 2)' : '';
        parts.push(`КД ${a.ac + (a.bonus || 0)}${dex} (${({ light: 'лёгкий', medium: 'средний', heavy: 'тяжёлый' })[a.kind]})`);
      }
      if (a.str) parts.push(`нужна Сила ${a.str}, иначе скорость −3 м`);
      if (a.stealth) parts.push('помеха на Скрытность');
    }
    parts.push(...fmtMods(d.mods));
    if (d.use) {
      const u = d.use;
      if (u.kind === 'heal') parts.push(`Лечит ${u.dice} хитов`);
      if (u.kind === 'buff') {
        const m = fmtMods(u.mods);
        parts.push(`${u.name}${m.length ? ': ' + m.join(', ') : ''}${u.duration ? ` на ${u.duration}` : ''}`);
      }
      if (u.kind === 'spell') parts.push(`Урон ${u.dice} ${u.type}${u.save ? ` (${u.save})` : ''}`);
      if (u.text) parts.push(u.text);
    }
    if (d.charges) parts.push(`Зарядов: ${item.charges ?? d.charges}/${d.charges}`);
    if (d.desc) parts.push(d.desc);
    return parts.filter(Boolean).map(p => p.replace(/\.$/, '')).map(p => p[0].toUpperCase() + p.slice(1)).join('. ') + '.';
  }

  /* ---------- снаряжение ---------- */

  const isTwoHanded = d => !!d?.weapon?.props?.includes('two');

  /**
   * В какой слот надеть предмет и что придётся снять.
   * equipment — { slot: item }. Возвращает { slot, clear: [слоты], error }.
   */
  function planEquip(item, equipment, wantSlot) {
    const d = defOf(item);
    if (!d || !d.slot) return { error: 'Этот предмет нельзя надеть' };
    const eq = equipment || {};
    const mainDef = defOf(eq.mainhand);
    if (d.slot === 'ring') {
      const slot = wantSlot === 'ring1' || wantSlot === 'ring2' ? wantSlot : (!eq.ring1 ? 'ring1' : !eq.ring2 ? 'ring2' : 'ring1');
      return { slot, clear: [slot] };
    }
    if (d.slot === 'shield') {
      const clear = ['offhand'];
      if (isTwoHanded(mainDef)) clear.push('mainhand');
      return { slot: 'offhand', clear };
    }
    if (d.slot === 'weapon') {
      if (isTwoHanded(d)) return { slot: 'mainhand', clear: ['mainhand', 'offhand'] };
      const light = d.weapon?.props?.includes('light');
      let slot = wantSlot === 'offhand' || wantSlot === 'mainhand' ? wantSlot : (!eq.mainhand ? 'mainhand' : (light && !eq.offhand ? 'offhand' : 'mainhand'));
      if (slot === 'offhand') {
        if (!light) return { error: 'Во второй руке — только лёгкое оружие или щит' };
        if (isTwoHanded(mainDef)) return { error: 'Обе руки заняты двуручным оружием' };
        if (mainDef && !mainDef.weapon?.props?.includes('light')) return { error: 'Для боя двумя оружиями оба должны быть лёгкими' };
      }
      return { slot, clear: [slot] };
    }
    if (SLOT_IDS.includes(d.slot)) return { slot: d.slot, clear: [d.slot] };
    return { error: 'Этот предмет нельзя надеть' };
  }

  /* ---------- характеристики ---------- */

  const abilityMod = score => Math.floor((Number(score) - 10) / 2);
  const profBonus = level => 2 + Math.floor((Math.max(1, Number(level) || 1) - 1) / 4);

  /** Действующие эффекты (зелья, свитки). Раунды считаются по счётчику раундов боя. */
  function activeEffects(character, round) {
    const r = Number(round) || 1;
    return (Array.isArray(character?.effects) ? character.effects : []).filter(e =>
      e && (e.untilRound == null || (r >= (Number(e.startRound) || 1) && r <= Number(e.untilRound))));
  }

  function sumMods(list) {
    const total = { ac: 0, saves: 0, attack: 0, damage: 0, spell: 0, speed: 0, sets: {}, extraDamage: [] };
    for (const m of list) {
      if (!m) continue;
      for (const k of ['ac', 'saves', 'attack', 'damage', 'spell', 'speed']) total[k] += Number(m[k]) || 0;
      for (const a of ABILITIES) {
        const key = 'set' + a.id[0].toUpperCase() + a.id.slice(1);
        if (m[key]) total.sets[a.id] = Math.max(total.sets[a.id] || 0, Number(m[key]));
      }
      if (m.extraDamage) total.extraDamage.push(m.extraDamage);
    }
    return total;
  }

  /** Всё, что нужно для листа персонажа: КД, атаки, характеристики с учётом снаряжения и эффектов. */
  function stats(character, round) {
    const c = character || {};
    const eq = c.equipment || {};
    const effects = activeEffects(c, round);
    const equippedDefs = SLOT_IDS.map(s => defOf(eq[s])).filter(Boolean);
    const mods = sumMods([...equippedDefs.map(d => d.mods), ...effects.map(e => e.mods)]);

    const base = c.abilities || {};
    const abilities = {}, abilityMods = {};
    for (const a of ABILITIES) {
      const raw = Number(base[a.id]) || 10;
      abilities[a.id] = Math.max(raw, mods.sets[a.id] || 0);
      abilityMods[a.id] = abilityMod(abilities[a.id]);
    }
    const prof = profBonus(c.level);
    const dex = abilityMods.dex, str = abilityMods.str;

    // КД
    const armor = defOf(eq.chest)?.armor;
    const shield = defOf(eq.offhand)?.armor;
    let ac = 10 + dex, acNote = 'без доспеха: 10 + ЛОВ';
    if (armor) {
      const a = armor.ac + (armor.bonus || 0);
      if (armor.kind === 'light') { ac = a + dex; acNote = `${defOf(eq.chest).name}: ${a} + ЛОВ`; }
      else if (armor.kind === 'medium') { ac = a + Math.min(2, dex); acNote = `${defOf(eq.chest).name}: ${a} + ЛОВ (макс. 2)`; }
      else { ac = a; acNote = `${defOf(eq.chest).name}: ${a}`; }
    }
    if (shield?.kind === 'shield') ac += shield.ac + (shield.bonus || 0);
    ac += mods.ac;

    let speed = 9 + mods.speed;
    const notes = [];
    if (armor?.str && abilities.str < armor.str) { speed -= 3; notes.push(`Сила меньше ${armor.str}: скорость −3 м`); }
    if (armor?.stealth) notes.push('Помеха на Скрытность (доспех)');

    // Атаки
    const attacks = [];
    const makeAttack = (slot, item, d, offhand) => {
      const w = d.weapon;
      const props = w.props || [];
      const ranged = props.includes('ranged');
      const ability = ranged ? 'dex' : props.includes('finesse') ? (dex > str ? 'dex' : 'str') : 'str';
      const am = abilityMods[ability];
      const bonus = Number(w.bonus) || 0;
      const twoHandsFree = !offhand && w.versatile && !eq.offhand;
      const dice = twoHandsFree ? w.versatile : w.dice;
      const dmgMod = (offhand && am > 0 ? 0 : am) + bonus + mods.damage;
      const extras = [...(w.extra ? [w.extra] : []), ...mods.extraDamage];
      attacks.push({
        slot, name: item.name, icon: item.icon, toHit: prof + am + bonus + mods.attack,
        dice, dmgMod, type: w.type, extras, ability, range: w.range || null,
        note: [twoHandsFree ? 'двумя руками' : '', offhand ? 'второй рукой (бонусное действие)' : ''].filter(Boolean).join(', ')
      });
    };
    const mainDef = defOf(eq.mainhand), offDef = defOf(eq.offhand);
    if (mainDef?.weapon) makeAttack('mainhand', eq.mainhand, mainDef, false);
    if (offDef?.weapon) makeAttack('offhand', eq.offhand, offDef, true);
    if (!attacks.length) {
      attacks.push({ slot: 'unarmed', name: 'Безоружный удар', icon: '👊', toHit: prof + str + mods.attack, dice: '1', dmgMod: str + mods.damage, type: 'дробящий', extras: mods.extraDamage, ability: 'str', note: '' });
    }

    return {
      abilities, abilityMods, prof, ac, acNote, speed, saves: mods.saves, spell: mods.spell,
      attacks, effects, notes
    };
  }

  /** Бросок атаки оружием: d20 + бонус, урон (на 20 кости урона удваиваются). Возвращает данные для показа. */
  function rollAttack(character, slot, round) {
    const at = stats(character, round).attacks.find(a => a.slot === slot);
    if (!at) return null;
    const d20 = 1 + Math.floor(Math.random() * 20);
    const crit = d20 === 20, fail = d20 === 1;
    const main = rollDice(at.dice, crit);
    const extras = at.extras.map(x => ({ ...x, r: rollDice(x.dice, crit) }));
    const damage = Math.max(1, main.total + at.dmgMod) + extras.reduce((s, x) => s + x.r.total, 0);
    const parts = [`${at.dice}${crit ? '×2' : ''} [${main.rolls.join(', ') || at.dice}]${at.dmgMod ? ' ' + signed(at.dmgMod) : ''} ${at.type}`,
      ...extras.map(x => `${x.dice}${crit ? '×2' : ''} [${x.r.rolls.join(', ')}] ${x.type}`)];
    return {
      name: at.name, d20, toHit: at.toHit, total: d20 + at.toHit, crit, fail, damage,
      detail: fail ? 'Промах (выпала 1)' : `Урон: ${damage}${crit ? ' — КРИТ!' : ''} · ${parts.join(' + ')}`
    };
  }

  const api = {
    rollAttack,
    SLOTS, SLOT_IDS, ABILITIES, PROPS, CATEGORIES, CATALOG, POOLS,
    byId: id => BY_ID.get(id) || null, defOf, describe, planEquip, stats, activeEffects,
    parseDice, diceMin, diceMax, rollDice, abilityMod, profBonus, isTwoHanded,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.ItemsCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
