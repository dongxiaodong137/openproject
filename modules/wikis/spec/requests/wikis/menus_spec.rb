# frozen_string_literal: true

#-- copyright
# OpenProject is an open source project management software.
# Copyright (C) the OpenProject GmbH
#
# This program is free software; you can redistribute it and/or
# modify it under the terms of the GNU General Public License version 3.
#
# OpenProject is a fork of ChiliProject, which is a fork of Redmine. The copyright follows:
# Copyright (C) 2006-2013 Jean-Philippe Lang
# Copyright (C) 2010-2013 the ChiliProject Team
#
# This program is free software; you can redistribute it and/or
# modify it under the terms of the GNU General Public License
# as published by the Free Software Foundation; either version 2
# of the License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program; if not, write to the Free Software
# Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301, USA.
#
# See COPYRIGHT and LICENSE files for more details.
#++

require "spec_helper"

RSpec.describe "Wikis menu", :skip_csrf, type: :rails_request do
  shared_let(:user) { create(:user) }

  before { login_as user }

  describe "GET /wikis/menu" do
    it "renders the submenu with the main pages entry selected" do
      get "/wikis/menu"

      expect(response).to have_http_status(:ok)
      expect(page).to have_css(".op-submenu--item-action.selected", text: I18n.t("wikis.index.queries.main"))
      expect(page).to have_text I18n.t("wikis.index.queries.all")
    end

    it "selects the all pages entry when the all query is active" do
      get "/wikis/menu", params: { query_id: "all" }

      expect(page).to have_css(".op-submenu--item-action.selected", text: I18n.t("wikis.index.queries.all"))
      expect(page).to have_no_css(".op-submenu--item-action.selected", text: I18n.t("wikis.index.queries.main"))
    end
  end
end
