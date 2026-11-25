// Token Radar's browser page, written from scratch in plain script. It takes
// window.RADAR, which main.ts drops next to dashboard/, and turns it into the
// ranked board, the searchable table, and a detail drawer holding the model's
// own inputs plus the protocol's farm plan. Nothing here fetches anything:
// every byte on screen already sits inside data.js.
(function() {
    'use strict';

    var BOARD = window.RADAR;
    if (!BOARD) {
        return;
    }
    var mount = document.getElementById('board');
    var ui = {
        q: '',
        category: 'all',
        tab: 'pre-token',
        sort: 'implied',
        dir: -1,
        selected: null,
        earlyOnly: false
    };

    // A tiny DOM builder: mk('div', {class: 'x', text: 'hi'}, childA, childB).
    // Attribute keys named class/text/html get special treatment, keys that
    // start with "on" become listeners, and anything else becomes an attribute.
    function mk(tag, attrs) {
        var node = document.createElement(tag);
        if (attrs) {
            Object.keys(attrs).forEach(function (key) {
                var value = attrs[key];
                if (key === 'class') {
                    node.className = value;
                } else if (key === 'text') {
                    node.textContent = value;
                } else if (key === 'html') {
                    node.innerHTML = value;
                } else if (key.slice(0, 2) === 'on') {
                    node.addEventListener(key.slice(2), value);
                } else if (value !== null && value !== undefined) {
                    node.setAttribute(key, value);
                }
            });
        }
        var idx = 2;
        while (idx < arguments.length) {
            var kid = arguments[idx];
            idx += 1;
            if (kid === null || kid === undefined) {
                continue;
            }
            if (Array.isArray(kid)) {
                kid.forEach(function (c) {
                    if (c) {
                        node.appendChild(c);
                    }
                });
            } else if (typeof kid === 'string') {
                node.appendChild(document.createTextNode(kid));
            } else {
                node.appendChild(kid);
            }
        }
        return node;
    }

    var moneyFmt = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 0
    });

    // Money in the board's compact form: billions, millions, thousands, then
    // the plain currency format. Missing or wild values show as n/a.
    function money(n) {
        if (n === null || n === undefined || !isFinite(n)) {
            return 'n/a';
        }
        var mag = Math.abs(n);
        if (mag >= 1e9) {
            return '$' + (n / 1e9).toFixed(2) + 'B';
        }
        if (mag >= 1e6) {
            return '$' + (n / 1e6).toFixed(1) + 'M';
        }
        if (mag >= 1e3) {
            return '$' + Math.round(n / 1e3) + 'K';
        }
        return moneyFmt.format(n);
    }

    // A weekly move with its sign, two decimals and a percent mark.
    function pct(n) {
        if (n === null || n === undefined || !isFinite(n)) {
            return 'n/a';
        }
        return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
    }

    // Age in whole days, or years once it passes a full year.
    function ageLabel(days) {
        if (days === null || days === undefined) {
            return 'unknown';
        }
        if (days >= 365) {
            return (days / 365).toFixed(1) + 'y';
        }
        return Math.max(0, Math.round(days)) + 'd';
    }

    // The scoring model, repeated here so the page can re-derive a row from
    // the snapshot figures and show it next to the number board.json holds.
    // Keeping the same arithmetic in two places is deliberate: if the two
    // disagree, the detail drawer says so out loud.
    var CAT_TOP = ['lending', 'dexs', 'cdp', 'derivatives', 'yield', 'rwa'];
    var CAT_MID = [
        'yield aggregator',
        'onchain capital allocator',
        'risk curators',
        'basis trading'
    ];
    var CAT_LOW = [
        'liquid staking',
        'liquid restaking',
        'staking pool',
        'bridge',
        'canonical bridge'
    ];

    function catFactor(p, model) {
        var c = (p.category || '').toLowerCase();
        if (CAT_TOP.indexOf(c) >= 0) {
            return model.category_high;
        }
        if (CAT_MID.indexOf(c) >= 0) {
            return model.category_mid;
        }
        if (CAT_LOW.indexOf(c) >= 0) {
            return model.category_low;
        }
        return 1;
    }

    function ageFactor(row, model) {
        var age = row.age_days;
        if (age === null || age === undefined) {
            return model.unknown_age_mult;
        }
        if (age < model.age_prime_low) {
            return model.age_new_mult;
        }
        if (age <= model.age_prime_high) {
            return model.age_prime_mult;
        }
        if (age <= 1095) {
            return model.age_mid_mult;
        }
        return model.age_old_mult;
    }

    function recompute(row, model) {
        var change = row.change_7d;
        if (change === null || change === undefined) {
            change = 0;
        }
        var clamped = Math.max(model.growth_floor, Math.min(model.growth_cap, change));
        var growthFactor = 1 + (clamped / 100) * model.growth_weight;
        var chainCount = (row.chains || []).length - 1;
        var cappedChains = Math.min(chainCount, model.breadth_max_chains);
        var breadthFactor = 1 + model.breadth_per_chain * Math.max(0, cappedChains);
        var raw = row.tvl_usd * model.base_multiple * growthFactor;
        raw = raw * ageFactor(row, model) * breadthFactor * catFactor(row, model);
        return Math.max(1, Math.round(raw));
    }

    // The farm plan is derived the same way main.ts derives it for board.json:
    // category, chains, TVL and age pick the action, the stake, the hold and
    // every cost and time. No protocol name gets its own branch.
    function mainChain(p) {
        if (p.chains && p.chains.length > 0) {
            return p.chains[0];
        }
        return 'its main chain';
    }

    function stakeFor(p) {
        if (p.tvl_usd >= 5e9) {
            return 250;
        }
        if (p.tvl_usd >= 1e9) {
            return 150;
        }
        if (p.tvl_usd >= 1e8) {
            return 100;
        }
        return 50;
    }

    function holdFor(age) {
        if (age === null || age === undefined) {
            return 30;
        }
        if (age < 180) {
            return 60;
        }
        if (age < 365) {
            return 45;
        }
        return 30;
    }

    function firstAction(p, stake, net) {
        var cat = (p.category || '').toLowerCase();
        var proto = p.name;
        if (cat.indexOf('lend') >= 0 || cat.indexOf('cdp') >= 0 || cat.indexOf('collateral') >= 0) {
            return 'Supply $' + stake + ' of USDC to ' + proto + ' on ' + net + ' and keep the position open.';
        }
        if (cat.indexOf('dex') >= 0 || cat.indexOf('yield') >= 0 || cat.indexOf('leveraged farm') >= 0) {
            return 'Provide $' + stake + ' of liquidity to ' + proto + "'s main pool on " + net + ' and keep the position open.';
        }
        if (cat.indexOf('bridge') >= 0) {
            return 'Bridge $' + stake + ' of USDC to ' + net + ' through ' + proto + ' and use the bridged funds in its app.';
        }
        if (cat.indexOf('staking') >= 0 || cat.indexOf('restak') >= 0) {
            return "Stake $" + stake + " of the chain's staking asset through " + proto + ' and keep the receipt.';
        }
        if (cat.indexOf('perpetual') >= 0 || cat.indexOf('derivative') >= 0) {
            return 'Deposit $' + stake + ' of USDC as margin on ' + proto + ' and open one small hedge.';
        }
        if (cat.indexOf('prediction') >= 0) {
            return 'Fund $' + stake + ' and place one market position on ' + proto + '.';
        }
        if (cat.indexOf('curator') >= 0 || cat.indexOf('allocator') >= 0) {
            return 'Deposit $' + stake + ' into a ' + proto + ' vault on ' + net + ' and keep the shares.';
        }
        if (cat.indexOf('stable') >= 0) {
            return 'Mint or deposit $' + stake + ' of the stable asset through ' + proto + ' on ' + net + '.';
        }
        if (cat.indexOf('rwa') >= 0) {
            return "Mint $" + stake + " of the protocol's yield asset on " + net + ' and hold it.';
        }
        if (cat.indexOf('insurance') >= 0) {
            return 'Buy $' + stake + ' of cover from ' + proto + ' on ' + net + ' and keep the policy.';
        }
        if (cat.indexOf('basis') >= 0) {
            return 'Deposit $' + stake + ' of USDC into ' + proto + "'s basis vault on " + net + ' and keep the position open.';
        }
        if (cat.indexOf('chain') >= 0) {
            return 'Use ' + proto + ' on ' + net + ' with $' + stake + ' of activity and keep using it weekly.';
        }
        if (cat.indexOf('payment') >= 0) {
            return 'Pay $' + stake + ' through ' + proto + ' on ' + net + ' and keep the receipts.';
        }
        return 'Deposit $' + stake + ' of USDC into ' + proto + ' on ' + net + ' and keep the position open.';
    }

    function weeklyAction(p) {
        var cat = (p.category || '').toLowerCase();
        var proto = p.name;
        if (cat.indexOf('lend') >= 0 || cat.indexOf('cdp') >= 0 || cat.indexOf('collateral') >= 0) {
            return 'Each week, borrow a small amount against the deposit on ' + proto + ' and repay it, so the wallet shows both sides of the market.';
        }
        if (cat.indexOf('dex') >= 0 || cat.indexOf('yield') >= 0) {
            return 'Each week, swap a small amount in ' + proto + "'s main pool and add a little liquidity, so the wallet shows repeated use.";
        }
        if (cat.indexOf('bridge') >= 0) {
            return 'Each week, bridge a small amount through ' + proto + ' and use it on the destination chain, so the wallet shows repeated crossings.';
        }
        if (cat.indexOf('staking') >= 0 || cat.indexOf('restak') >= 0) {
            return 'Each week, check the staking rewards on ' + proto + ' and restake a small amount, so the wallet shows continued staking.';
        }
        if (cat.indexOf('perpetual') >= 0 || cat.indexOf('derivative') >= 0) {
            return 'Each week, open and close one small hedged trade on ' + proto + ', so the wallet shows repeated trading.';
        }
        if (cat.indexOf('prediction') >= 0) {
            return 'Each week, place one small market position on ' + proto + ', so the wallet shows repeated participation.';
        }
        if (cat.indexOf('curator') >= 0 || cat.indexOf('allocator') >= 0) {
            return 'Each week, check the vault\'s allocation on ' + proto + ' and top it up a little, so the wallet shows continued deposits.';
        }
        if (cat.indexOf('rwa') >= 0) {
            return 'Each week, check the yield asset\'s accrual on ' + proto + ' and hold it, so the wallet shows a long position.';
        }
        return 'Each week, make one qualifying action on ' + proto + ', such as a deposit, a swap or a vote, so the wallet shows repeated use.';
    }

    // One step becomes a single line: the action, then its cost and time.
    // Overlong lines are cut to the kit's limit; a stub too short to read
    // gets a holding instruction appended.
    function stepLine(step) {
        var line = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
        if (line.length > 600) {
            line = line.slice(0, 596) + '...';
        }
        if (line.length < 20) {
            line = line + " Hold the position and check the protocol's own page.";
        }
        return line;
    }

    function planSteps(p) {
        var net = mainChain(p);
        var stake = stakeFor(p);
        var hold = holdFor(p.age_days);
        var gas = stake >= 150 ? 8 : 4;
        var steps = [
            {
                text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
                cost: 'under $3 of gas for the first transaction',
                time: '5 minutes'
            },
            {
                text: firstAction(p, stake, net),
                cost: '$' + stake + ' of capital and about $' + gas + ' of gas',
                time: '15 minutes to set up'
            },
            {
                text: weeklyAction(p),
                cost: 'about $2 of gas a week',
                time: '10 minutes a week'
            },
            {
                text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.',
                cost: 'the $' + stake + ' stays in the position',
                time: hold + ' days'
            },
            {
                text: "Check the protocol's TVL and 7-day growth once a week; unwind the position if TVL falls by more than 30% in a week or the team goes quiet.",
                cost: 'nothing but the check',
                time: '5 minutes a week'
            },
            {
                text: "Before you withdraw, open the protocol's own points or rewards page from the link it publishes itself, and never pay to claim or follow a claim link from a direct message.",
                cost: 'no fee to check, and never pay to claim',
                time: '10 minutes'
            },
            {
                text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it, and withdraw in stages instead of all at once.',
                cost: 'nothing but the log',
                time: '5 minutes'
            }
        ];
        return steps.map(stepLine);
    }

    // The hash carries the search, the category and the open row, so a view
    // can be linked to and a refresh lands back on it.
    function loadHash() {
        var raw = window.location.hash.replace(/^#/, '');
        if (!raw) {
            return;
        }
        var params = new URLSearchParams(raw);
        if (params.get('q')) {
            ui.q = params.get('q');
        }
        if (params.get('p')) {
            ui.selected = params.get('p');
        }
        if (params.get('category')) {
            ui.category = params.get('category');
        }
    }

    function saveHash() {
        var params = new URLSearchParams();
        if (ui.q) {
            params.set('q', ui.q);
        }
        if (ui.category !== 'all') {
            params.set('category', ui.category);
        }
        if (ui.selected) {
            params.set('p', ui.selected);
        }
        var next = params.toString();
        if (next) {
            window.history.replaceState(null, '', '#' + next);
        } else {
            window.history.replaceState(null, '', window.location.pathname + window.location.search);
        }
    }

    // The visible rows: the early-gems switch, the category picker and the
    // search box, each narrowing the same list.
    function visibleRows() {
        var q = ui.q.trim().toLowerCase();
        return BOARD.rows.filter(function (r) {
            if (ui.earlyOnly && (r.tvl_usd >= BOARD.floor_usd || (r.age_days !== null && r.age_days > 540))) {
                return false;
            }
            if (ui.category !== 'all' && r.category !== ui.category) {
                return false;
            }
            if (!q) {
                return true;
            }
            var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
            return hay.indexOf(q) >= 0;
        });
    }

    // Sorting by the active column, with the slug as the tie-break so the
    // order is stable no matter how the browser sorts equal values.
    function orderedRows(list) {
        var key = ui.sort;
        return list.slice().sort(function (a, b) {
            var av;
            var bv;
            if (key === 'name') {
                av = a.name.toLowerCase();
                bv = b.name.toLowerCase();
            } else if (key === 'tvl') {
                av = a.tvl_usd;
                bv = b.tvl_usd;
            } else if (key === 'growth') {
                av = a.change_7d === null ? -Infinity : a.change_7d;
                bv = b.change_7d === null ? -Infinity : b.change_7d;
            } else if (key === 'age') {
                av = a.age_days === null ? Infinity : a.age_days;
                bv = b.age_days === null ? Infinity : b.age_days;
            } else {
                av = a.implied_value_usd;
                bv = b.implied_value_usd;
            }
            if (av < bv) {
                return -ui.dir;
            }
            if (av > bv) {
                return ui.dir;
            }
            if (a.slug < b.slug) {
                return -1;
            }
            if (a.slug > b.slug) {
                return 1;
            }
            return 0;
        });
    }

    function masthead() {
        return mk('header', { class: 'top' },
            mk('div', { class: 'brand' },
                mk('span', { class: 'mark' }),
                mk('span', { class: 'brand-name', text: 'Token Radar' })
            ),
            mk('div', { class: 'top-meta' },
                mk('span', { text: 'Snapshot ' + BOARD.as_of }),
                mk('span', { text: 'DefiLlama protocol index' }),
                mk('span', { text: BOARD.model_version + ' model' })
            )
        );
    }

    function intro() {
        var floorM = Math.round(BOARD.floor_usd / 1e6);
        var lead = 'The watchlist is the floor: every protocol with at least $' + floorM +
            'M of TVL and no token on record. The early radar adds ' + BOARD.early_size +
            ' pre-token protocols below that floor. Implied value is a model, not a promise.';
        return mk('section', { class: 'lede' },
            mk('div', null,
                mk('h1', { text: BOARD.watchlist_size + ' watchlist protocols, ranked by implied value' }),
                mk('p', { text: lead })
            ),
            mk('div', { class: 'facts' },
                mk('div', { class: 'fact' },
                    mk('span', { text: 'Watchlist covered' }),
                    mk('b', { text: BOARD.watchlist_size + ' / ' + BOARD.watchlist_size })
                ),
                mk('div', { class: 'fact' },
                    mk('span', { text: 'Pre-token rows scored' }),
                    mk('b', { text: String(BOARD.board_size) })
                ),
                mk('div', { class: 'fact' },
                    mk('span', { text: 'Early rows below the floor' }),
                    mk('b', { text: String(BOARD.early_size) })
                ),
                mk('div', { class: 'fact' },
                    mk('span', { text: 'Live-token protocols set aside' }),
                    mk('b', { text: String(BOARD.live_size) })
                )
            )
        );
    }

    function filters() {
        var cats = Array.from(new Set(BOARD.rows.map(function (r) {
            return r.category || 'Other';
        }))).sort();
        var queryBox = mk('input', {
            type: 'search',
            id: 'q',
            placeholder: 'Search name, category or chain',
            value: ui.q,
            'aria-label': 'Search the board'
        });
        queryBox.addEventListener('input', function () {
            ui.q = queryBox.value;
            saveHash();
            paint();
        });
        var catPick = mk('select', { id: 'category', 'aria-label': 'Filter by category' },
            mk('option', { value: 'all', text: 'All categories' }),
            cats.map(function (c) {
                var chosen = c === ui.category ? 'selected' : null;
                return mk('option', { value: c, text: c, selected: chosen });
            })
        );
        catPick.addEventListener('change', function () {
            ui.category = catPick.value;
            saveHash();
            paint();
        });
        var preBtn = mk('button', {
            type: 'button',
            'aria-pressed': ui.tab === 'pre-token' ? 'true' : 'false',
            text: 'Pre-token',
            onclick: function () {
                ui.tab = 'pre-token';
                paint();
            }
        });
        var liveBtn = mk('button', {
            type: 'button',
            'aria-pressed': ui.tab === 'live' ? 'true' : 'false',
            text: 'Live token',
            onclick: function () {
                ui.tab = 'live';
                paint();
            }
        });
        var gemsBtn = mk('button', {
            type: 'button',
            'aria-pressed': ui.earlyOnly ? 'true' : 'false',
            text: 'Early gems only',
            onclick: function () {
                ui.earlyOnly = !ui.earlyOnly;
                paint();
            }
        });
        var shown = ui.tab === 'pre-token'
            ? visibleRows().length + ' rows shown'
            : BOARD.live.length + ' live-token protocols';
        return mk('div', { class: 'controls' },
            mk('div', { class: 'field' },
                mk('label', { for: 'q', text: 'Search' }),
                queryBox
            ),
            mk('div', { class: 'field' },
                mk('label', { for: 'category', text: 'Category' }),
                catPick
            ),
            mk('div', { class: 'field' },
                mk('span', { class: 'sub', text: 'Token status' }),
                mk('div', { class: 'tabs' }, preBtn, liveBtn)
            ),
            mk('div', { class: 'field' },
                mk('span', { class: 'sub', text: 'Focus' }),
                mk('div', { class: 'tabs' }, gemsBtn)
            ),
            mk('span', { class: 'count', text: shown })
        );
    }

    // A sortable column head: clicking flips the direction when it is already
    // the active sort, and picks the column otherwise.
    function sortCell(key, label) {
        var arrow = null;
        if (ui.sort === key) {
            arrow = mk('span', { 'aria-hidden': 'true', text: ui.dir < 0 ? ' v' : ' ^' });
        }
        return mk('th', { scope: 'col' },
            mk('button', {
                type: 'button',
                onclick: function () {
                    if (ui.sort === key) {
                        ui.dir = -ui.dir;
                    } else {
                        ui.sort = key;
                        ui.dir = -1;
                    }
                    paint();
                }
            }, label, arrow)
        );
    }

    function preTable() {
        var ordered = orderedRows(visibleRows());
        if (ordered.length === 0) {
            return mk('div', { class: 'panel' },
                mk('div', { class: 'empty' },
                    mk('h2', { text: 'No protocol matches that filter' }),
                    mk('p', { text: 'Clear the search or pick another category to see the board again.' }),
                    mk('button', {
                        class: 'button primary',
                        type: 'button',
                        text: 'Clear filters',
                        onclick: function () {
                            ui.q = '';
                            ui.category = 'all';
                            saveHash();
                            paint();
                        }
                    })
                )
            );
        }
        var top = ordered[0].implied_value_usd || 1;
        var tbody = mk('tbody');
        ordered.forEach(function (r) {
            var growth = r.change_7d === null ? 'n/a' : pct(r.change_7d);
            var growthClass = r.change_7d === null ? '' : (r.change_7d >= 0 ? 'pos' : 'neg');
            var chainLabel = (r.chains && r.chains.length)
                ? r.chains.slice(0, 2).join(', ')
                : 'an unnamed chain';
            var barWidth = Math.max(3, Math.round((r.implied_value_usd / top) * 100));
            var tr = mk('tr', {
                'data-selected': ui.selected === r.slug ? 'true' : 'false',
                tabindex: '0',
                onclick: function () {
                    showDetail(r.slug);
                },
                onkeydown: function (e) {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        showDetail(r.slug);
                    }
                }
            },
                mk('td', { class: 'num', text: String(r.rank) }),
                mk('td', null,
                    mk('div', { class: 'name' },
                        mk('b', { text: r.name }),
                        mk('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chainLabel })
                    )
                ),
                mk('td', { class: 'num', text: money(r.tvl_usd) }),
                mk('td', { class: 'num ' + growthClass, text: growth }),
                mk('td', { class: 'num', text: ageLabel(r.age_days) }),
                mk('td', null,
                    mk('div', { class: 'implied' },
                        mk('div', { class: 'bar', 'aria-hidden': 'true' },
                            mk('i', { style: 'width:' + barWidth + '%' })
                        ),
                        mk('span', { class: 'num', text: money(r.implied_value_usd) })
                    )
                ),
                mk('td', null, mk('span', { class: 'status', text: 'no token' }))
            );
            tbody.appendChild(tr);
        });
        return mk('div', { class: 'panel' },
            mk('div', { class: 'table-wrap' },
                mk('table', null,
                    mk('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
                    mk('thead', null,
                        mk('tr', null,
                            sortCell('implied', 'Rank'),
                            sortCell('name', 'Protocol'),
                            sortCell('tvl', 'TVL'),
                            sortCell('growth', '7d'),
                            sortCell('age', 'Age'),
                            sortCell('implied', 'Implied value'),
                            mk('th', { scope: 'col', text: 'Token' })
                        )
                    ),
                    tbody
                )
            )
        );
    }

    function liveBoard() {
        var tbody = mk('tbody');
        BOARD.live.forEach(function (r) {
            var chainLabel = (r.chains && r.chains.length)
                ? r.chains.slice(0, 2).join(', ')
                : 'an unnamed chain';
            var up = r.change_7d !== null && r.change_7d >= 0;
            tbody.appendChild(mk('tr', null,
                mk('td', { class: 'num', text: 'live' }),
                mk('td', null,
                    mk('div', { class: 'name' },
                        mk('b', { text: r.name }),
                        mk('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chainLabel })
                    )
                ),
                mk('td', { class: 'num', text: money(r.tvl_usd) }),
                mk('td', { class: 'num ' + (up ? 'pos' : 'neg'), text: pct(r.change_7d) }),
                mk('td', { class: 'num', text: money(r.mcap_usd) }),
                mk('td', null, mk('span', { class: 'status', text: 'already trades' }))
            ));
        });
        return mk('div', { class: 'panel' },
            mk('div', { class: 'table-wrap' },
                mk('table', null,
                    mk('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
                    mk('thead', null,
                        mk('tr', null,
                            mk('th', { scope: 'col', text: 'Status' }),
                            mk('th', { scope: 'col', text: 'Protocol' }),
                            mk('th', { scope: 'col', text: 'TVL' }),
                            mk('th', { scope: 'col', text: '7d' }),
                            mk('th', { scope: 'col', text: 'Market cap' }),
                            mk('th', { scope: 'col', text: 'Token' })
                        )
                    ),
                    tbody
                )
            )
        );
    }

    function modelBox() {
        var m = BOARD.model;
        var formula = 'implied = round( tvl_usd x ' + m.base_multiple +
            ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap +
            ') / 100 x ' + m.growth_weight + ') x age_mult x (1 + ' + m.breadth_per_chain +
            ' x min(chains - 1, ' + m.breadth_max_chains + ')) x category_mult )';
        var ages = 'Age: under ' + m.age_prime_low + ' days scores ' + m.age_new_mult +
            ', ' + m.age_prime_low + '-' + m.age_prime_high + ' days scores ' + m.age_prime_mult +
            ' (the prime launch window), ' + m.age_prime_high + '-1095 days scores ' + m.age_mid_mult +
            ', older scores ' + m.age_old_mult + '.';
        var cats = ' Category: Lending, Dexs, CDP, Derivatives, Yield and RWA score ' + m.category_high +
            '; Yield Aggregator, Onchain Capital Allocator, Risk Curators and Basis Trading score ' + m.category_mid +
            '; Liquid Staking, Liquid Restaking, Staking Pool and Bridge score ' + m.category_low +
            '; the rest score 1.00. The early radar is every rankable pre-token protocol below the watchlist floor, and the live-token protocols are set aside with their market caps shown.';
        return mk('section', { class: 'panel model' },
            mk('h2', { text: 'How implied value is computed' }),
            mk('p', { class: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
            mk('div', { class: 'formula' }, formula),
            mk('p', { class: 'sub', text: ages + cats })
        );
    }

    function riskBox() {
        return mk('section', { class: 'panel model' },
            mk('h2', { text: 'Read this before you farm' }),
            mk('p', { class: 'sub', text: 'A protocol on this board records no token. That is a record in the snapshot, not a promise: it may never issue one, and an implied value is a model estimate, never a price. Never pay to claim an airdrop, and only open a points or rewards page from the link the protocol itself publishes. Start small, hold the position, and unwind it if the numbers turn.' })
        );
    }

    var sheet = mk('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
    sheet.addEventListener('close', function () {
        ui.selected = null;
        saveHash();
    });

    function showDetail(slug) {
        var found = BOARD.rows.filter(function (r) {
            return r.slug === slug;
        });
        var row = found[0];
        if (!row) {
            return;
        }
        ui.selected = slug;
        saveHash();
        sheet.textContent = '';
        var steps = planSteps(row);
        var chainLabel = (row.chains && row.chains.length)
            ? row.chains.join(', ')
            : 'an unnamed chain';
        sheet.appendChild(mk('div', { class: 'detail-head' },
            mk('div', null,
                mk('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + BOARD.board_size }),
                mk('h2', { id: 'detail-title', text: row.name }),
                mk('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + chainLabel })
            ),
            mk('button', {
                class: 'close',
                type: 'button',
                'aria-label': 'Close details',
                text: 'Close',
                onclick: function () {
                    sheet.close();
                }
            })
        ));
        var again = recompute(row, BOARD.model);
        var verdict = again === row.implied_value_usd
            ? ', the same number board.json carries.'
            : ', which differs from the board: the data would be stale.';
        var note = 'Model ' + BOARD.model_version +
            ': the same function scores every protocol. The page recomputes this row as ' +
            money(again) + verdict + ' This is an estimate, not a price.';
        sheet.appendChild(mk('section', { class: 'detail-section' },
            mk('h3', { text: 'Implied value' }),
            mk('div', { class: 'equation' },
                mk('div', null, mk('span', { text: 'TVL' }), mk('b', { class: 'num', text: money(row.tvl_usd) })),
                mk('div', null, mk('span', { text: 'Seven-day growth' }), mk('b', { class: 'num', text: pct(row.change_7d) })),
                mk('div', null, mk('span', { text: 'Age with no token' }), mk('b', { class: 'num', text: ageLabel(row.age_days) })),
                mk('div', null, mk('span', { text: 'Growth multiplier' }), mk('b', { class: 'num', text: String(row.growth_multiplier) })),
                mk('div', null, mk('span', { text: 'Age multiplier' }), mk('b', { class: 'num', text: String(row.age_multiplier) })),
                mk('div', null, mk('span', { text: 'Breadth multiplier' }), mk('b', { class: 'num', text: String(row.breadth_multiplier) })),
                mk('div', null, mk('span', { text: 'Category multiplier' }), mk('b', { class: 'num', text: String(row.category_multiplier) })),
                mk('div', null, mk('span', { text: 'Implied value' }), mk('b', { class: 'num', text: money(row.implied_value_usd) }))
            ),
            mk('p', { class: 'sub', text: note })
        ));
        sheet.appendChild(mk('section', { class: 'detail-section' },
            mk('h3', { text: 'Farm plan' }),
            mk('ol', { class: 'steps' }, steps.map(function (s) {
                var at = s.indexOf(' Cost: ');
                var action = at >= 0 ? s.slice(0, at) : s;
                var tail = at >= 0 ? s.slice(at + 1) : '';
                return mk('li', null,
                    mk('b', { text: action }),
                    mk('span', { class: 'cost', text: tail })
                );
            }))
        ));
        if (typeof sheet.showModal === 'function') {
            if (!sheet.open) {
                sheet.showModal();
            }
        } else {
            sheet.setAttribute('open', '');
        }
    }

    // Rebuild the whole page from the current view state.
    function paint() {
        mount.textContent = '';
        var shell = mk('div', { class: 'shell' });
        shell.appendChild(masthead());
        shell.appendChild(intro());
        shell.appendChild(filters());
        if (ui.tab === 'pre-token') {
            shell.appendChild(preTable());
            shell.appendChild(modelBox());
            shell.appendChild(riskBox());
        } else {
            shell.appendChild(liveBoard());
        }
        mount.appendChild(shell);
        mount.setAttribute('aria-busy', 'false');
        if (!sheet.isConnected) {
            mount.appendChild(sheet);
        }
        if (ui.selected) {
            showDetail(ui.selected);
        }
    }

    loadHash();
    paint();
    window.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && sheet.open) {
            sheet.close();
        }
    });
})();
